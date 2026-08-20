//! CLAP host implementation for the truce-rack framework.
//!
//! CLAP is the simplest format to host because the entire API is
//! pure C with no platform-specific oddities. truce-rack-clap uses
//! `clap-sys` for raw bindings and `libloading` to open plugin
//! bundles at runtime — no C++ glue is involved.
//!
//! # Lifecycle
//!
//! Each `.clap` bundle ships a single `clap_entry` symbol. The
//! scanner opens the bundle, calls `entry.init(path)`, asks the
//! factory at `CLAP_PLUGIN_FACTORY_ID` to enumerate its plugins,
//! converts each `clap_plugin_descriptor` into a [`PluginInfo`]
//! and then calls `entry.deinit()` to release scanner-only state.
//!
//! [`ClapScanner::load`] re-opens the bundle, holds the entry +
//! library alive for the lifetime of the returned [`ClapPlugin`],
//! and on `Drop` calls the plugin's `destroy` followed by the
//! entry's `deinit`.

use truce_rack_core::buffer::AudioBuffer;
use truce_rack_core::bus::BusLayout;
use truce_rack_core::error::{Error, Result};
use truce_rack_core::events::EventList;
use truce_rack_core::info::{ParameterInfo, PluginCategory, PluginInfo, PresetInfo};
use truce_rack_core::plugin::{Plugin, PluginCore, ProcessContext, ProcessStatus};
use truce_rack_core::transport::TransportInfo;
use truce_rack_core::scanner::PluginScanner;
use truce_rack_core::wrapper::run_audio_block_with;

use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{
    CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_MIDI, CLAP_EVENT_NOTE_OFF, CLAP_EVENT_NOTE_ON,
    CLAP_EVENT_PARAM_VALUE, CLAP_EVENT_TRANSPORT, CLAP_TRANSPORT_HAS_BEATS_TIMELINE,
    CLAP_TRANSPORT_HAS_SECONDS_TIMELINE, CLAP_TRANSPORT_HAS_TEMPO,
    CLAP_TRANSPORT_HAS_TIME_SIGNATURE, CLAP_TRANSPORT_IS_LOOP_ACTIVE, CLAP_TRANSPORT_IS_PLAYING,
    CLAP_TRANSPORT_IS_RECORDING, clap_event_header, clap_event_midi, clap_event_note,
    clap_event_param_value, clap_event_transport, clap_input_events, clap_output_events,
    clap_transport_flags,
};
use clap_sys::fixedpoint::{CLAP_BEATTIME_FACTOR, CLAP_SECTIME_FACTOR};
use clap_sys::ext::gui::{
    CLAP_EXT_GUI, CLAP_WINDOW_API_COCOA, CLAP_WINDOW_API_WIN32, CLAP_WINDOW_API_X11,
    clap_plugin_gui, clap_window, clap_window_handle,
};
use clap_sys::ext::params::{
    CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE, CLAP_PARAM_IS_BYPASS, CLAP_PARAM_IS_ENUM,
    CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY, CLAP_PARAM_IS_STEPPED, clap_param_info,
    clap_plugin_params,
};
use clap_sys::ext::state::{CLAP_EXT_STATE, clap_plugin_state};
use clap_sys::factory::plugin_factory::{CLAP_PLUGIN_FACTORY_ID, clap_plugin_factory};
use clap_sys::host::clap_host;
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{
    CLAP_PROCESS_CONTINUE, CLAP_PROCESS_CONTINUE_IF_NOT_QUIET, CLAP_PROCESS_ERROR,
    CLAP_PROCESS_SLEEP, CLAP_PROCESS_TAIL, clap_process,
};
use clap_sys::stream::{clap_istream, clap_ostream};
use clap_sys::version::CLAP_VERSION;

use std::ffi::{CStr, CString, c_char, c_void};
use std::path::{Path, PathBuf};
use std::ptr;

/// Format identifier — used as the `format` field on
/// [`PluginInfo`] entries this crate returns.
pub const FORMAT: &str = "clap";

/// Filename extension every CLAP plugin uses, including the
/// leading dot.
pub const CLAP_EXTENSION: &str = ".clap";

/// Symbol name `clap_entry` plugins must export.
const ENTRY_SYMBOL: &[u8] = b"clap_entry\0";

// ---------------------------------------------------------------------------
// Minimal `clap_host` passed to `clap_plugin_factory::create_plugin`.
//
// The CLAP spec requires a non-null host; plugins commonly assert on
// it (nih-plug does). This stub advertises no host extensions and
// ignores restart/process/callback requests, which is enough for
// offline (non-GUI) hosting.
// ---------------------------------------------------------------------------

const HOST_NAME: &[u8] = b"truce-rack host\0";
const HOST_VENDOR: &[u8] = b"truce-audio\0";
const HOST_URL: &[u8] = b"https://github.com/truce-audio/truce-rack\0";
const HOST_VERSION: &[u8] = b"1.1.5\0";

unsafe extern "C" fn host_get_extension(
    _host: *const clap_host,
    _extension_id: *const c_char,
) -> *const c_void {
    ptr::null()
}

unsafe extern "C" fn host_request_restart(_host: *const clap_host) {}
unsafe extern "C" fn host_request_process(_host: *const clap_host) {}
unsafe extern "C" fn host_request_callback(_host: *const clap_host) {}

static MINIMAL_HOST: clap_host = clap_host {
    clap_version: CLAP_VERSION,
    host_data: ptr::null_mut(),
    name: HOST_NAME.as_ptr().cast(),
    vendor: HOST_VENDOR.as_ptr().cast(),
    url: HOST_URL.as_ptr().cast(),
    version: HOST_VERSION.as_ptr().cast(),
    get_extension: Some(host_get_extension),
    request_restart: Some(host_request_restart),
    request_process: Some(host_request_process),
    request_callback: Some(host_request_callback),
};

/// CLAP scanner.
///
/// Walks the standard CLAP plugin directories for the current OS
/// and returns one entry per discovered CLAP plugin. Calling
/// [`PluginScanner::scan_path`] lets a host scan a custom
/// directory (useful for sandboxed test fixtures or
/// per-application bundled plugins).
#[derive(Debug, Default)]
pub struct ClapScanner;

impl ClapScanner {
    /// Construct a default scanner. There's no config state; the
    /// type exists so consumers have a stable handle to scan
    /// from.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl PluginScanner for ClapScanner {
    type Plugin = ClapPlugin;

    fn scan(&self) -> Result<Vec<PluginInfo>> {
        let mut out = Vec::new();
        for dir in default_clap_paths() {
            if dir.exists() {
                scan_dir_into(&dir, &mut out);
            }
        }
        Ok(out)
    }

    fn scan_path(&self, path: &Path) -> Result<Vec<PluginInfo>> {
        let mut out = Vec::new();
        if path.exists() {
            scan_dir_into(path, &mut out);
        }
        Ok(out)
    }

    fn load(&self, info: &PluginInfo) -> Result<Self::Plugin> {
        ClapPlugin::load_from(info)
    }
}

/// Standard locations the CLAP spec lists for each OS. Mirrors
/// what the CLAP example host walks.
#[must_use]
pub fn default_clap_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let mut user = PathBuf::from(home);
        #[cfg(target_os = "macos")]
        user.push("Library/Audio/Plug-Ins/CLAP");
        #[cfg(target_os = "linux")]
        user.push(".clap");
        #[cfg(target_os = "windows")]
        user.push("AppData/Local/Programs/Common/CLAP");
        out.push(user);
    }
    #[cfg(target_os = "macos")]
    out.push(PathBuf::from("/Library/Audio/Plug-Ins/CLAP"));
    #[cfg(target_os = "linux")]
    out.push(PathBuf::from("/usr/lib/clap"));
    #[cfg(target_os = "windows")]
    {
        if let Some(pf) = std::env::var_os("CommonProgramFiles") {
            let mut p = PathBuf::from(pf);
            p.push("CLAP");
            out.push(p);
        }
    }
    out
}

fn scan_dir_into(dir: &Path, out: &mut Vec<PluginInfo>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(CLAP_EXTENSION) {
            continue;
        }
        // Failure to scan one bundle should not abort the whole
        // walk — the host still wants the plugins it can see.
        if let Err(err) = scan_bundle_into(&path, out) {
            eprintln!("[truce-rack-clap] skipping {}: {err}", path.display());
        }
    }
}

fn scan_bundle_into(bundle_path: &Path, out: &mut Vec<PluginInfo>) -> Result<()> {
    let binary = bundle_binary_path(bundle_path);
    let handle = unsafe { LoadedLibrary::open(&binary)? };
    let entry = handle.entry()?;
    unsafe { entry.init(&binary)? };
    let factory = unsafe { entry.factory() };
    if !factory.is_null() {
        let count = unsafe { ((*factory).get_plugin_count.unwrap_or(empty_count))(factory) };
        for idx in 0..count {
            let desc =
                unsafe { ((*factory).get_plugin_descriptor.unwrap_or(empty_desc))(factory, idx) };
            if desc.is_null() {
                continue;
            }
            out.push(unsafe { descriptor_to_info(bundle_path, &*desc) });
        }
    }
    unsafe { entry.deinit() };
    Ok(())
}

unsafe extern "C" fn empty_count(_: *const clap_plugin_factory) -> u32 {
    0
}

unsafe extern "C" fn empty_desc(
    _: *const clap_plugin_factory,
    _: u32,
) -> *const clap_plugin_descriptor {
    ptr::null()
}

/// Per-platform `.clap` bundle layout. macOS uses NSBundle-style
/// `Contents/MacOS/<stem>`; Linux / Windows treat the `.clap`
/// file itself as the dylib.
fn bundle_binary_path(bundle: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let stem = bundle.file_stem().unwrap_or_default();
        if bundle.is_dir() {
            return bundle.join("Contents/MacOS").join(stem);
        }
    }
    bundle.to_path_buf()
}

unsafe fn descriptor_to_info(bundle_path: &Path, desc: &clap_plugin_descriptor) -> PluginInfo {
    let id = unsafe { cstr_to_string(desc.id) };
    let name = unsafe { cstr_to_string(desc.name) };
    let vendor = unsafe { cstr_to_string(desc.vendor) };
    let version_str = unsafe { cstr_to_string(desc.version) };
    let version = parse_version(&version_str);
    let (category, accepts_midi) = unsafe { categorize(desc.features) };
    PluginInfo {
        name,
        vendor,
        version,
        category,
        path: bundle_path.to_path_buf(),
        unique_id: id,
        format: FORMAT,
        has_editor: false, // honest default — set during load via the GUI ext.
        accepts_midi,
    }
}

/// CLAP feature strings live in a NULL-terminated array of C
/// strings. We scan for instrument / note-effect / analyzer
/// markers and the `note-input` / `note-effect` markers used to
/// flag MIDI capability.
unsafe fn categorize(features: *const *const c_char) -> (PluginCategory, bool) {
    if features.is_null() {
        return (PluginCategory::Effect, false);
    }
    let mut category = PluginCategory::Effect;
    let mut accepts_midi = false;
    let mut idx = 0usize;
    loop {
        let p = unsafe { *features.add(idx) };
        if p.is_null() {
            break;
        }
        let bytes = unsafe { CStr::from_ptr(p).to_bytes() };
        match bytes {
            b"instrument" => category = PluginCategory::Instrument,
            b"note-effect" => {
                category = PluginCategory::NoteEffect;
                accepts_midi = true;
            }
            b"analyzer" => category = PluginCategory::Analyzer,
            b"utility" => category = PluginCategory::Tool,
            b"note-input" => accepts_midi = true,
            _ => {}
        }
        idx += 1;
    }
    (category, accepts_midi)
}

/// CLAP versions are `"major.minor.patch"`. We pack the first
/// three numeric components into a `u32` as
/// `(major << 16) | (minor << 8) | patch`, matching what the
/// legacy rack used.
fn parse_version(s: &str) -> u32 {
    let mut parts = s.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);
    (major << 16) | (minor << 8) | patch
}

fn empty_param_info() -> clap_param_info {
    clap_param_info {
        id: 0,
        flags: 0,
        cookie: ptr::null_mut(),
        name: [0; clap_sys::string_sizes::CLAP_NAME_SIZE],
        module: [0; clap_sys::string_sizes::CLAP_PATH_SIZE],
        min_value: 0.0,
        max_value: 0.0,
        default_value: 0.0,
    }
}

fn clap_param_info_to_rack(info: &clap_param_info) -> ParameterInfo {
    let name = c_buf_to_string(&info.name);
    let mut flags = truce_rack_core::info::ParameterFlags::empty();
    if info.flags & CLAP_PARAM_IS_BYPASS != 0 {
        flags |= truce_rack_core::info::ParameterFlags::BYPASS;
    }
    if info.flags & CLAP_PARAM_IS_AUTOMATABLE != 0 {
        flags |= truce_rack_core::info::ParameterFlags::AUTOMATABLE;
    }
    if info.flags & CLAP_PARAM_IS_HIDDEN != 0 {
        flags |= truce_rack_core::info::ParameterFlags::HIDDEN;
    }
    if info.flags & CLAP_PARAM_IS_READONLY != 0 {
        flags |= truce_rack_core::info::ParameterFlags::READ_ONLY;
    }
    if info.flags & CLAP_PARAM_IS_ENUM != 0 {
        flags |= truce_rack_core::info::ParameterFlags::ENUMERATED;
    }
    let step_count = if info.flags & CLAP_PARAM_IS_STEPPED != 0 {
        // Stepped parameters have integer-valued [min, max]; the
        // step count is the number of distinct values.
        #[allow(clippy::cast_possible_truncation)]
        let span = (info.max_value - info.min_value).round() as i64;
        u32::try_from(span + 1).unwrap_or(0)
    } else {
        0
    };
    ParameterInfo {
        id: info.id,
        name: name.clone(),
        short_name: name,
        unit: String::new(), // CLAP doesn't expose a separate unit field
        min: info.min_value,
        max: info.max_value,
        default: info.default_value,
        step_count,
        flags,
    }
}

#[allow(clippy::cast_sign_loss)]
fn c_buf_to_string(buf: &[c_char]) -> String {
    // CLAP `char` is signed on Apple toolchains, unsigned elsewhere;
    // the cast preserves bit pattern, which is what
    // `String::from_utf8_lossy` wants.
    let bytes: Vec<u8> = buf
        .iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

unsafe fn cstr_to_string(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
}

/// RAII wrapper around a `libloading::Library` plus the
/// `clap_entry` symbol it exports.
struct LoadedLibrary {
    library: libloading::Library,
}

impl LoadedLibrary {
    unsafe fn open(path: &Path) -> Result<Self> {
        // SAFETY: caller guarantees `path` points at a valid
        // CLAP plugin bundle binary; `libloading::Library::new`
        // is itself the OS dlopen call.
        let library = unsafe { libloading::Library::new(path) }.map_err(|e| Error::LoadFailed {
            path: path.to_path_buf(),
            reason: format!("dlopen failed: {e}"),
        })?;
        Ok(Self { library })
    }

    fn entry(&self) -> Result<EntryRef<'_>> {
        let symbol: libloading::Symbol<'_, *const clap_plugin_entry> = unsafe {
            self.library
                .get(ENTRY_SYMBOL)
                .map_err(|e| Error::LoadFailed {
                    path: PathBuf::new(),
                    reason: format!("missing clap_entry symbol: {e}"),
                })?
        };
        let entry = *symbol;
        if entry.is_null() {
            return Err(Error::LoadFailed {
                path: PathBuf::new(),
                reason: "clap_entry symbol resolved to NULL".into(),
            });
        }
        Ok(EntryRef {
            entry,
            _phantom: std::marker::PhantomData,
        })
    }
}

struct EntryRef<'a> {
    entry: *const clap_plugin_entry,
    // The reference lifetime ties the entry pointer to the
    // library handle it was loaded from.
    #[allow(dead_code)]
    _phantom: std::marker::PhantomData<&'a LoadedLibrary>,
}

impl EntryRef<'_> {
    unsafe fn init(&self, path: &Path) -> Result<()> {
        let init = unsafe { (*self.entry).init };
        if let Some(init) = init {
            let c_path =
                CString::new(path.to_string_lossy().as_bytes()).map_err(|e| Error::LoadFailed {
                    path: path.to_path_buf(),
                    reason: format!("plugin path is not a valid C string: {e}"),
                })?;
            if !unsafe { init(c_path.as_ptr()) } {
                return Err(Error::LoadFailed {
                    path: path.to_path_buf(),
                    reason: "clap_entry::init returned false".into(),
                });
            }
        }
        Ok(())
    }

    unsafe fn deinit(&self) {
        if let Some(deinit) = unsafe { (*self.entry).deinit } {
            unsafe { deinit() };
        }
    }

    unsafe fn factory(&self) -> *const clap_plugin_factory {
        let Some(get_factory) = (unsafe { (*self.entry).get_factory }) else {
            return ptr::null();
        };
        let raw = unsafe { get_factory(CLAP_PLUGIN_FACTORY_ID.as_ptr()) };
        raw.cast::<clap_plugin_factory>()
    }
}

/// One loaded CLAP plugin instance.
///
/// Holds the raw `*const clap_plugin` pointer plus the metadata
/// needed for the truce-rack-core trait impls. The pointer is owned —
/// `Drop` calls `clap_plugin::destroy` and `clap_entry::deinit`.
pub struct ClapPlugin {
    info: PluginInfo,
    layouts: Vec<BusLayout>,
    active_layout: Option<BusLayout>,
    plugin: *const clap_plugin,
    library: LoadedLibrary,
    bundle_path: PathBuf,
    started_processing: bool,
    /// Cached `clap.params` extension. NULL if the plugin doesn't
    /// expose any parameters.
    params_ext: *const clap_plugin_params,
    /// Cached `clap.state` extension. NULL if the plugin doesn't
    /// expose state save/load.
    state_ext: *const clap_plugin_state,
    /// Cached `clap.gui` extension. NULL when the plugin has no
    /// custom editor.
    gui_ext: *const clap_plugin_gui,
    /// Whether the editor has been `create`d but not yet
    /// `destroy`ed — `clap.gui` separates the two lifecycles.
    gui_open: bool,
    /// Running `steady_time` counter — CLAP wants a monotonically
    /// increasing sample-count across activations.
    steady_time: i64,
    /// Parameter changes queued from `set_parameter` while the
    /// plugin is processing; drained into the next `process` call's
    /// input events.
    pending_param_changes: Vec<(u32, f64)>,
}

// SAFETY: The CLAP spec is explicit that a plugin handle may be
// moved between threads when audio processing is stopped. Within
// truce-rack-clap we serialize all calls through `&mut self`, so the
// pointer is never aliased.
unsafe impl Send for ClapPlugin {}

impl ClapPlugin {
    fn load_from(info: &PluginInfo) -> Result<Self> {
        let bundle_path = info.path.clone();
        let binary = bundle_binary_path(&bundle_path);
        let library = unsafe { LoadedLibrary::open(&binary)? };
        let entry = library.entry()?;
        unsafe { entry.init(&binary)? };
        let factory = unsafe { entry.factory() };
        if factory.is_null() {
            unsafe { entry.deinit() };
            return Err(Error::LoadFailed {
                path: bundle_path,
                reason: "plugin has no clap.plugin-factory".into(),
            });
        }
        let create = unsafe { (*factory).create_plugin }.ok_or_else(|| Error::LoadFailed {
            path: bundle_path.clone(),
            reason: "factory missing create_plugin".into(),
        })?;
        let id_cstring = CString::new(info.unique_id.as_str()).map_err(|e| Error::LoadFailed {
            path: bundle_path.clone(),
            reason: format!("plugin id is not a valid C string: {e}"),
        })?;
        let host = &raw const MINIMAL_HOST;
        let plugin = unsafe { create(factory, host, id_cstring.as_ptr()) };
        if plugin.is_null() {
            unsafe { entry.deinit() };
            return Err(Error::LoadFailed {
                path: bundle_path,
                reason: "factory.create_plugin returned NULL".into(),
            });
        }
        let init = unsafe { (*plugin).init }.ok_or_else(|| Error::LoadFailed {
            path: bundle_path.clone(),
            reason: "plugin missing init".into(),
        })?;
        if !unsafe { init(plugin) } {
            if let Some(destroy) = unsafe { (*plugin).destroy } {
                unsafe { destroy(plugin) };
            }
            unsafe { entry.deinit() };
            return Err(Error::LoadFailed {
                path: bundle_path,
                reason: "clap_plugin::init returned false".into(),
            });
        }
        let params_ext = unsafe { lookup_extension::<clap_plugin_params>(plugin, CLAP_EXT_PARAMS) };
        let state_ext = unsafe { lookup_extension::<clap_plugin_state>(plugin, CLAP_EXT_STATE) };
        let gui_ext = unsafe { lookup_extension::<clap_plugin_gui>(plugin, CLAP_EXT_GUI) };
        let mut info = info.clone();
        if !gui_ext.is_null() && unsafe { gui_supports_current_platform(plugin, gui_ext) } {
            info.has_editor = true;
        }
        Ok(Self {
            info,
            layouts: vec![BusLayout::stereo()],
            active_layout: None,
            plugin,
            library,
            bundle_path,
            started_processing: false,
            params_ext,
            state_ext,
            gui_ext,
            gui_open: false,
            steady_time: 0,
            pending_param_changes: Vec::new(),
        })
    }
}

/// Look up a CLAP extension by id. Returns `null` if the plugin
/// doesn't implement that extension. The returned pointer's
/// lifetime is the plugin instance; callers must not outlive
/// the plugin.
unsafe fn lookup_extension<T>(plugin: *const clap_plugin, id: &CStr) -> *const T {
    let Some(get_extension) = (unsafe { (*plugin).get_extension }) else {
        return ptr::null();
    };
    let raw = unsafe { get_extension(plugin, id.as_ptr()) };
    raw.cast::<T>()
}

impl Drop for ClapPlugin {
    fn drop(&mut self) {
        if !self.plugin.is_null() {
            if self.gui_open
                && let Some(destroy) = unsafe { (*self.gui_ext).destroy }
            {
                unsafe { destroy(self.plugin) };
                self.gui_open = false;
            }
            if self.started_processing
                && let Some(stop) = unsafe { (*self.plugin).stop_processing }
            {
                unsafe { stop(self.plugin) };
            }
            if self.active_layout.is_some()
                && let Some(deactivate) = unsafe { (*self.plugin).deactivate }
            {
                unsafe { deactivate(self.plugin) };
            }
            if let Some(destroy) = unsafe { (*self.plugin).destroy } {
                unsafe { destroy(self.plugin) };
            }
        }
        if let Ok(entry) = self.library.entry() {
            unsafe { entry.deinit() };
        }
        // `library` drops here, unloading the dylib.
        let _ = &self.bundle_path; // keep PathBuf alive for diagnostics
    }
}

impl PluginCore for ClapPlugin {
    fn info(&self) -> &PluginInfo {
        &self.info
    }

    fn active_layout(&self) -> Option<&BusLayout> {
        self.active_layout.as_ref()
    }

    fn supported_layouts(&self) -> &[BusLayout] {
        &self.layouts
    }

    fn parameter_count(&self) -> usize {
        if self.params_ext.is_null() {
            return 0;
        }
        let count = unsafe { (*self.params_ext).count };
        count.map_or(0, |c| unsafe { c(self.plugin) as usize })
    }

    fn parameter_info(&self, index: usize) -> Result<ParameterInfo> {
        if self.params_ext.is_null() {
            return Err(Error::InvalidParameter(index));
        }
        let get_info =
            unsafe { (*self.params_ext).get_info }.ok_or(Error::InvalidParameter(index))?;
        let mut info = empty_param_info();
        let idx_u32 = u32::try_from(index).map_err(|_| Error::InvalidParameter(index))?;
        let ok = unsafe { get_info(self.plugin, idx_u32, &raw mut info) };
        if !ok {
            return Err(Error::InvalidParameter(index));
        }
        Ok(clap_param_info_to_rack(&info))
    }

    fn parameter_value(&self, index: usize) -> Result<f64> {
        if self.params_ext.is_null() {
            return Err(Error::InvalidParameter(index));
        }
        // Resolve index -> id via get_info, then ask get_value
        // for the current value. CLAP's params API is id-keyed,
        // not index-keyed.
        let info = self.parameter_info(index)?;
        let get_value =
            unsafe { (*self.params_ext).get_value }.ok_or(Error::InvalidParameter(index))?;
        let mut out = 0.0f64;
        let ok = unsafe { get_value(self.plugin, info.id, &raw mut out) };
        if !ok {
            return Err(Error::InvalidParameter(index));
        }
        Ok(out)
    }

    fn parameter_value_string(&self, index: usize, value: f64) -> Result<String> {
        if self.params_ext.is_null() {
            return Err(Error::InvalidParameter(index));
        }
        let info = self.parameter_info(index)?;
        let value_to_text =
            unsafe { (*self.params_ext).value_to_text }.ok_or(Error::InvalidParameter(index))?;
        let mut buf = [0i8; clap_sys::string_sizes::CLAP_NAME_SIZE];
        let buf_len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        let ok = unsafe { value_to_text(self.plugin, info.id, value, buf.as_mut_ptr(), buf_len) };
        if !ok {
            return Err(Error::InvalidParameter(index));
        }
        Ok(c_buf_to_string(&buf))
    }

    fn set_parameter(&mut self, index: usize, value: f64) -> Result<()> {
        if self.params_ext.is_null() {
            return Err(Error::InvalidParameter(index));
        }
        let info = self.parameter_info(index)?;
        // Queue the change either way; process() drains the queue
        // every block, and a non-processing host can call flush()
        // to apply it immediately.
        self.pending_param_changes.push((info.id, value));
        if !self.started_processing
            && let Some(flush) = unsafe { (*self.params_ext).flush }
        {
            let events = std::mem::take(&mut self.pending_param_changes);
            let mut converted = ConvertedInputEvents { events: Vec::new() };
            for (param_id, value) in events {
                converted.push_param_value(0, param_id, value);
            }
            let input = converted.as_clap();
            let mut sink = OutputEventsSink::new(None);
            let output = sink.as_clap();
            unsafe { flush(self.plugin, &raw const input, &raw const output) };
        }
        Ok(())
    }

    fn preset_count(&self) -> usize {
        0
    }

    fn preset_info(&self, index: usize) -> Result<PresetInfo> {
        Err(Error::InvalidParameter(index))
    }

    fn load_preset(&mut self, _preset_number: i32) -> Result<()> {
        Err(Error::Other("clap preset loading not yet wired".into()))
    }

    fn save_state(&self) -> Result<Vec<u8>> {
        if self.state_ext.is_null() {
            return Err(Error::Other("plugin missing clap.state extension".into()));
        }
        let save = unsafe { (*self.state_ext).save }
            .ok_or_else(|| Error::Other("clap.state extension missing save fn".into()))?;
        let mut buffer = WriteBuffer::default();
        let stream = clap_ostream {
            ctx: (&raw mut buffer).cast(),
            write: Some(ostream_write),
        };
        let ok = unsafe { save(self.plugin, &raw const stream) };
        if !ok {
            return Err(Error::Other("clap state save returned false".into()));
        }
        Ok(buffer.bytes)
    }

    fn load_state(&mut self, bytes: &[u8]) -> Result<()> {
        if self.state_ext.is_null() {
            return Err(Error::Other("plugin missing clap.state extension".into()));
        }
        let load = unsafe { (*self.state_ext).load }
            .ok_or_else(|| Error::Other("clap.state extension missing load fn".into()))?;
        let mut cursor = ReadCursor { bytes, position: 0 };
        let stream = clap_istream {
            ctx: (&raw mut cursor).cast(),
            read: Some(istream_read),
        };
        let ok = unsafe { load(self.plugin, &raw const stream) };
        if !ok {
            return Err(Error::Other("clap state load returned false".into()));
        }
        Ok(())
    }

    fn activate(
        &mut self,
        layout: BusLayout,
        sample_rate: f64,
        max_block_size: usize,
    ) -> Result<()> {
        let Some(activate) = (unsafe { (*self.plugin).activate }) else {
            return Err(Error::Other("clap plugin missing activate".into()));
        };
        let ok = unsafe {
            activate(
                self.plugin,
                sample_rate,
                1,
                u32::try_from(max_block_size).unwrap_or(u32::MAX),
            )
        };
        if !ok {
            return Err(Error::Other("clap_plugin::activate returned false".into()));
        }
        self.active_layout = Some(layout);
        Ok(())
    }

    fn deactivate(&mut self) {
        if self.started_processing {
            if let Some(stop) = unsafe { (*self.plugin).stop_processing } {
                unsafe { stop(self.plugin) };
            }
            self.started_processing = false;
        }
        if let Some(deactivate) = unsafe { (*self.plugin).deactivate } {
            unsafe { deactivate(self.plugin) };
        }
        self.active_layout = None;
    }

    fn is_active(&self) -> bool {
        self.active_layout.is_some()
    }

    fn editor(&mut self) -> Option<&mut dyn truce_rack_core::editor::PluginEditor> {
        if self.gui_ext.is_null() {
            return None;
        }
        Some(self)
    }
}

/// Platform API id we'd ask the plugin to support — one per
/// build target.
const fn platform_api() -> &'static CStr {
    #[cfg(target_os = "macos")]
    {
        CLAP_WINDOW_API_COCOA
    }
    #[cfg(target_os = "windows")]
    {
        CLAP_WINDOW_API_WIN32
    }
    #[cfg(target_os = "linux")]
    {
        CLAP_WINDOW_API_X11
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        CLAP_WINDOW_API_COCOA
    }
}

unsafe fn gui_supports_current_platform(
    plugin: *const clap_plugin,
    gui_ext: *const clap_plugin_gui,
) -> bool {
    let Some(is_supported) = (unsafe { (*gui_ext).is_api_supported }) else {
        return false;
    };
    unsafe { is_supported(plugin, platform_api().as_ptr(), false) }
}

fn handle_to_clap_window(handle: truce_rack_core::editor::WindowHandle) -> clap_window {
    use truce_rack_core::editor::WindowHandle;
    let (api, specific) = match handle {
        WindowHandle::NSView(p) => (
            CLAP_WINDOW_API_COCOA.as_ptr(),
            clap_window_handle { cocoa: p },
        ),
        WindowHandle::HWND(p) => (
            CLAP_WINDOW_API_WIN32.as_ptr(),
            clap_window_handle { win32: p },
        ),
        WindowHandle::X11(id) => (
            CLAP_WINDOW_API_X11.as_ptr(),
            clap_window_handle { x11: id as _ },
        ),
    };
    clap_window { api, specific }
}

impl truce_rack_core::editor::PluginEditor for ClapPlugin {
    fn open(
        &mut self,
        parent: truce_rack_core::editor::WindowHandle,
        scale: f64,
    ) -> truce_rack_core::error::Result<()> {
        if self.gui_open {
            return Ok(());
        }
        if self.gui_ext.is_null() {
            return Err(Error::Other("clap.gui extension absent".into()));
        }
        let api = platform_api();
        let create = unsafe { (*self.gui_ext).create }
            .ok_or_else(|| Error::Other("clap.gui missing `create`".into()))?;
        if !unsafe { create(self.plugin, api.as_ptr(), false) } {
            return Err(Error::Other("clap.gui::create returned false".into()));
        }
        if let Some(set_scale) = unsafe { (*self.gui_ext).set_scale } {
            let _ = unsafe { set_scale(self.plugin, scale) };
        }
        let window = handle_to_clap_window(parent);
        if let Some(set_parent) = unsafe { (*self.gui_ext).set_parent }
            && !unsafe { set_parent(self.plugin, &raw const window) }
        {
            if let Some(destroy) = unsafe { (*self.gui_ext).destroy } {
                unsafe { destroy(self.plugin) };
            }
            return Err(Error::Other("clap.gui::set_parent returned false".into()));
        }
        if let Some(show) = unsafe { (*self.gui_ext).show } {
            let _ = unsafe { show(self.plugin) };
        }
        self.gui_open = true;
        Ok(())
    }

    fn close(&mut self) {
        if !self.gui_open {
            return;
        }
        if let Some(hide) = unsafe { (*self.gui_ext).hide } {
            let _ = unsafe { hide(self.plugin) };
        }
        if let Some(destroy) = unsafe { (*self.gui_ext).destroy } {
            unsafe { destroy(self.plugin) };
        }
        self.gui_open = false;
    }

    fn is_open(&self) -> bool {
        self.gui_open
    }

    fn size(&self) -> Option<(u32, u32)> {
        if !self.gui_open {
            return None;
        }
        let get_size = unsafe { (*self.gui_ext).get_size }?;
        let mut w: u32 = 0;
        let mut h: u32 = 0;
        if unsafe { get_size(self.plugin, &raw mut w, &raw mut h) } {
            Some((w, h))
        } else {
            None
        }
    }

    fn is_resizable(&self) -> bool {
        if !self.gui_open {
            return false;
        }
        unsafe { (*self.gui_ext).can_resize }.is_some_and(|f| unsafe { f(self.plugin) })
    }

    fn set_size(&mut self, width: u32, height: u32) -> Option<(u32, u32)> {
        if !self.gui_open {
            return None;
        }
        let mut w = width;
        let mut h = height;
        if let Some(adjust) = unsafe { (*self.gui_ext).adjust_size } {
            let _ = unsafe { adjust(self.plugin, &raw mut w, &raw mut h) };
        }
        let set = unsafe { (*self.gui_ext).set_size }?;
        if unsafe { set(self.plugin, w, h) } {
            Some((w, h))
        } else {
            None
        }
    }

    fn show(&mut self) {
        if let Some(show) = unsafe { (*self.gui_ext).show } {
            let _ = unsafe { show(self.plugin) };
        }
    }

    fn hide(&mut self) {
        if let Some(hide) = unsafe { (*self.gui_ext).hide } {
            let _ = unsafe { hide(self.plugin) };
        }
    }
}

impl Plugin<f32> for ClapPlugin {
    fn process(
        &mut self,
        buffer: &mut AudioBuffer<'_, f32>,
        events: &EventList,
        context: &mut ProcessContext<'_>,
    ) -> Result<ProcessStatus> {
        if !self.is_active() {
            return Err(Error::NotActivated);
        }
        if !self.started_processing {
            if let Some(start) = unsafe { (*self.plugin).start_processing } {
                let ok = unsafe { start(self.plugin) };
                if !ok {
                    return Err(Error::Other(
                        "clap_plugin::start_processing returned false".into(),
                    ));
                }
            }
            self.started_processing = true;
        }

        // Translate the truce-rack event list into CLAP's typed event
        // unions. Plus any pending parameter changes from
        // set_parameter. The resulting Vec backs the
        // ConvertedInputEvents callbacks for the duration of the
        // process call.
        // Translate the host transport snapshot up front so its
        // backing struct lives for the whole process call.
        let transport_event = context
            .transport
            .map(|t| build_clap_transport(&t, context.sample_rate));

        let mut converted = ConvertedInputEvents::from_rack_events(events);
        for (param_id, value) in self.pending_param_changes.drain(..) {
            converted.push_param_value(0, param_id, value);
        }
        let input_events = converted.as_clap();
        let mut sink = OutputEventsSink::new(Some(context.output_events));
        let output_events = sink.as_clap();

        // Build per-channel pointer arrays for clap_audio_buffer.
        // These are constructed inline so they live for the
        // duration of the process call.
        let num_frames = buffer.num_frames();
        let main_inputs = buffer.main_inputs();
        let mut input_ptrs: Vec<*mut f32> = main_inputs
            .iter()
            .map(|chan| chan.as_ptr().cast_mut())
            .collect();
        let input_audio = clap_audio_buffer {
            data32: input_ptrs.as_mut_ptr(),
            data64: ptr::null_mut(),
            channel_count: u32::try_from(input_ptrs.len()).unwrap_or(0),
            latency: 0,
            constant_mask: 0,
        };

        let main_outputs = buffer.main_outputs();
        let mut output_ptrs: Vec<*mut f32> = main_outputs
            .iter_mut()
            .map(|chan| chan.as_mut_ptr())
            .collect();
        let mut output_audio = clap_audio_buffer {
            data32: output_ptrs.as_mut_ptr(),
            data64: ptr::null_mut(),
            channel_count: u32::try_from(output_ptrs.len()).unwrap_or(0),
            latency: 0,
            constant_mask: 0,
        };

        let process = clap_process {
            steady_time: self.steady_time,
            frames_count: u32::try_from(num_frames).unwrap_or(u32::MAX),
            transport: transport_event
                .as_ref()
                .map_or(ptr::null(), std::ptr::from_ref),
            audio_inputs: if input_ptrs.is_empty() {
                ptr::null()
            } else {
                &raw const input_audio
            },
            audio_outputs: if output_ptrs.is_empty() {
                ptr::null_mut()
            } else {
                &raw mut output_audio
            },
            audio_inputs_count: u32::from(!input_ptrs.is_empty()),
            audio_outputs_count: u32::from(!output_ptrs.is_empty()),
            in_events: &raw const input_events,
            out_events: &raw const output_events,
        };

        let plugin = self.plugin;
        let process_ptr = unsafe { (*plugin).process };
        let status = match process_ptr {
            Some(process_fn) => {
                run_audio_block_with::<ClapPlugin, i32>(FORMAT, CLAP_PROCESS_ERROR, || unsafe {
                    process_fn(plugin, &raw const process)
                })
            }
            None => CLAP_PROCESS_ERROR,
        };

        self.steady_time = self
            .steady_time
            .saturating_add(i64::try_from(num_frames).unwrap_or(0));

        Ok(map_clap_status(status))
    }
}

/// Translate a host [`TransportInfo`] snapshot into CLAP's
/// `clap_event_transport`. `sample_rate` converts the sample
/// position into the seconds timeline CLAP also wants.
///
/// CLAP beat / second times are 31.32 fixed-point (see
/// `CLAP_BEATTIME_FACTOR`); beats are quarter notes.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap
)]
fn build_clap_transport(t: &TransportInfo, sample_rate: f64) -> clap_event_transport {
    let beats_to_fixed = |b: f64| (b * CLAP_BEATTIME_FACTOR as f64).round() as i64;
    let secs_to_fixed = |s: f64| (s * CLAP_SECTIME_FACTOR as f64).round() as i64;

    let mut flags: clap_transport_flags = 0;
    let tempo = t.tempo_bpm.unwrap_or(0.0);
    if t.tempo_bpm.is_some() {
        flags |= CLAP_TRANSPORT_HAS_TEMPO;
    }
    let song_pos_beats = match t.song_position_beats {
        Some(b) => {
            flags |= CLAP_TRANSPORT_HAS_BEATS_TIMELINE;
            beats_to_fixed(b)
        }
        None => 0,
    };
    let song_pos_seconds = match t.song_position_samples {
        Some(s) => {
            flags |= CLAP_TRANSPORT_HAS_SECONDS_TIMELINE;
            secs_to_fixed(s as f64 / sample_rate.max(1.0))
        }
        None => 0,
    };
    let (tsig_num, tsig_denom) = match t.time_signature {
        Some((n, d)) => {
            flags |= CLAP_TRANSPORT_HAS_TIME_SIGNATURE;
            (n as u16, d as u16)
        }
        None => (0, 0),
    };
    let bar_start = t.bar_start_beats.map_or(0, beats_to_fixed);
    // Bar index: bar_start (in quarter notes) divided by the bar
    // length the time signature implies.
    let bar_number = match (t.bar_start_beats, t.time_signature) {
        (Some(bsb), Some((n, d))) => {
            let beats_per_bar = f64::from(n) * 4.0 / f64::from(d.max(1));
            (bsb / beats_per_bar.max(f64::EPSILON)).round() as i32
        }
        _ => 0,
    };
    if t.playing {
        flags |= CLAP_TRANSPORT_IS_PLAYING;
    }
    if t.recording {
        flags |= CLAP_TRANSPORT_IS_RECORDING;
    }
    if t.loop_active {
        flags |= CLAP_TRANSPORT_IS_LOOP_ACTIVE;
    }

    clap_event_transport {
        header: clap_event_header {
            size: u32::try_from(std::mem::size_of::<clap_event_transport>()).unwrap_or(0),
            time: 0,
            space_id: CLAP_CORE_EVENT_SPACE_ID,
            type_: CLAP_EVENT_TRANSPORT,
            flags: 0,
        },
        flags,
        song_pos_beats,
        song_pos_seconds,
        tempo,
        tempo_inc: 0.0,
        loop_start_beats: 0,
        loop_end_beats: 0,
        loop_start_seconds: 0,
        loop_end_seconds: 0,
        bar_start,
        bar_number,
        tsig_num,
        tsig_denom,
    }
}

fn map_clap_status(status: i32) -> ProcessStatus {
    match status {
        CLAP_PROCESS_CONTINUE | CLAP_PROCESS_CONTINUE_IF_NOT_QUIET => ProcessStatus::Continue,
        CLAP_PROCESS_SLEEP => ProcessStatus::Sleep,
        CLAP_PROCESS_TAIL => ProcessStatus::Tail { tail_samples: 0 },
        _ => ProcessStatus::Error,
    }
}

fn make_param_value_event(sample_offset: u32, param_id: u32, value: f64) -> clap_event_param_value {
    clap_event_param_value {
        header: clap_event_header {
            size: u32::try_from(std::mem::size_of::<clap_event_param_value>()).unwrap_or(0),
            time: sample_offset,
            space_id: CLAP_CORE_EVENT_SPACE_ID,
            type_: CLAP_EVENT_PARAM_VALUE,
            flags: 0,
        },
        param_id,
        cookie: ptr::null_mut(),
        note_id: -1,
        port_index: -1,
        channel: -1,
        key: -1,
        value,
    }
}

fn make_note_event(
    sample_offset: u32,
    event_type: u16,
    channel: u8,
    key: u8,
    velocity: f64,
) -> clap_event_note {
    clap_event_note {
        header: clap_event_header {
            size: u32::try_from(std::mem::size_of::<clap_event_note>()).unwrap_or(0),
            time: sample_offset,
            space_id: CLAP_CORE_EVENT_SPACE_ID,
            type_: event_type,
            flags: 0,
        },
        note_id: -1,
        port_index: -1,
        channel: i16::from(channel),
        key: i16::from(key),
        velocity,
    }
}

fn make_midi_event(sample_offset: u32, bytes: [u8; 3]) -> clap_event_midi {
    clap_event_midi {
        header: clap_event_header {
            size: u32::try_from(std::mem::size_of::<clap_event_midi>()).unwrap_or(0),
            time: sample_offset,
            space_id: CLAP_CORE_EVENT_SPACE_ID,
            type_: CLAP_EVENT_MIDI,
            flags: 0,
        },
        port_index: 0,
        data: bytes,
    }
}

/// Sink for `clap_plugin_state::save` — the plugin pushes bytes
/// via the C `write` callback, we accumulate into a Vec.
#[derive(Default)]
struct WriteBuffer {
    bytes: Vec<u8>,
}

unsafe extern "C" fn ostream_write(
    stream: *const clap_ostream,
    buffer: *const std::ffi::c_void,
    size: u64,
) -> i64 {
    if stream.is_null() || buffer.is_null() {
        return -1;
    }
    let ctx = unsafe { (*stream).ctx.cast::<WriteBuffer>() };
    if ctx.is_null() {
        return -1;
    }
    let Ok(size_usize) = usize::try_from(size) else {
        return -1;
    };
    let slice = unsafe { std::slice::from_raw_parts(buffer.cast::<u8>(), size_usize) };
    unsafe { (*ctx).bytes.extend_from_slice(slice) };
    i64::try_from(size_usize).unwrap_or(i64::MAX)
}

/// Source for `clap_plugin_state::load` — the plugin pulls bytes
/// via the C `read` callback, we hand back from a `&[u8]`.
struct ReadCursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

unsafe extern "C" fn istream_read(
    stream: *const clap_istream,
    buffer: *mut std::ffi::c_void,
    size: u64,
) -> i64 {
    if stream.is_null() || buffer.is_null() {
        return -1;
    }
    let ctx = unsafe { (*stream).ctx.cast::<ReadCursor<'_>>() };
    if ctx.is_null() {
        return -1;
    }
    let cursor = unsafe { &mut *ctx };
    let Ok(want) = usize::try_from(size) else {
        return -1;
    };
    let available = cursor.bytes.len().saturating_sub(cursor.position);
    let take = want.min(available);
    if take > 0 {
        unsafe {
            std::ptr::copy_nonoverlapping(
                cursor.bytes.as_ptr().add(cursor.position),
                buffer.cast::<u8>(),
                take,
            );
        }
        cursor.position += take;
    }
    i64::try_from(take).unwrap_or(i64::MAX)
}

/// Owned storage for one block's CLAP-formatted input events.
///
/// We can't ship `*const clap_event_header` directly off our
/// `EventList` because the truce-rack event payloads have different
/// layouts than CLAP's. The fix is to translate up front and keep
/// the result alive for the `process` call.
struct ConvertedInputEvents {
    /// Owned event memory — every entry is a CLAP event struct
    /// the input-events vtable hands out pointers into. Boxed so
    /// addresses survive `Vec` reallocation.
    events: Vec<EventStorage>,
}

#[allow(dead_code)]
enum EventStorage {
    Param(clap_event_param_value),
    Note(clap_event_note),
    Midi(clap_event_midi),
}

impl EventStorage {
    fn header(&self) -> *const clap_event_header {
        match self {
            Self::Param(e) => &raw const e.header,
            Self::Note(e) => &raw const e.header,
            Self::Midi(e) => &raw const e.header,
        }
    }
}

impl ConvertedInputEvents {
    fn from_rack_events(list: &EventList) -> Self {
        let mut out = Self { events: Vec::new() };
        for event in list {
            out.push_rack(event);
        }
        out
    }

    fn push_param_value(&mut self, sample_offset: u32, param_id: u32, value: f64) {
        self.events.push(EventStorage::Param(make_param_value_event(
            sample_offset,
            param_id,
            value,
        )));
    }

    fn push_rack(&mut self, event: &truce_rack_core::events::Event) {
        use truce_rack_core::events::EventBody;
        let offset = event.sample_offset;
        match event.body {
            EventBody::Midi(midi) => self.push_midi(offset, midi),
            EventBody::ParamValue { param_id, value } => {
                self.push_param_value(offset, param_id, value);
            }
            EventBody::ParamGesture { .. } | EventBody::TransportFlag(_) => {
                // ParamGesture: CLAP's begin/end events have
                // separate types; covered in a follow-on once
                // hosts start emitting them.
                // TransportFlag: routed through clap_event_transport
                // on the process struct, not via input events.
            }
        }
    }

    fn push_midi(&mut self, offset: u32, midi: truce_rack_core::events::MidiData) {
        use truce_rack_core::events::MidiData;
        match midi {
            MidiData::NoteOn {
                channel,
                note,
                velocity,
            } => {
                self.events.push(EventStorage::Note(make_note_event(
                    offset,
                    CLAP_EVENT_NOTE_ON,
                    channel,
                    note,
                    f64::from(velocity) / 127.0,
                )));
            }
            MidiData::NoteOff {
                channel,
                note,
                velocity,
            } => {
                self.events.push(EventStorage::Note(make_note_event(
                    offset,
                    CLAP_EVENT_NOTE_OFF,
                    channel,
                    note,
                    f64::from(velocity) / 127.0,
                )));
            }
            MidiData::ControlChange {
                channel,
                controller,
                value,
            } => {
                let status = 0xB0 | (channel & 0x0F);
                self.events.push(EventStorage::Midi(make_midi_event(
                    offset,
                    [status, controller & 0x7F, value & 0x7F],
                )));
            }
            MidiData::ProgramChange { channel, program } => {
                let status = 0xC0 | (channel & 0x0F);
                self.events.push(EventStorage::Midi(make_midi_event(
                    offset,
                    [status, program & 0x7F, 0],
                )));
            }
            MidiData::PolyAftertouch {
                channel,
                note,
                pressure,
            } => {
                let status = 0xA0 | (channel & 0x0F);
                self.events.push(EventStorage::Midi(make_midi_event(
                    offset,
                    [status, note & 0x7F, pressure & 0x7F],
                )));
            }
            MidiData::ChannelAftertouch { channel, pressure } => {
                let status = 0xD0 | (channel & 0x0F);
                self.events.push(EventStorage::Midi(make_midi_event(
                    offset,
                    [status, pressure & 0x7F, 0],
                )));
            }
            MidiData::PitchBend { channel, value } => {
                let status = 0xE0 | (channel & 0x0F);
                let lsb = u8::try_from(value & 0x7F).unwrap_or(0);
                let msb = u8::try_from((value >> 7) & 0x7F).unwrap_or(0);
                self.events.push(EventStorage::Midi(make_midi_event(
                    offset,
                    [status, lsb, msb],
                )));
            }
            MidiData::Raw { len, data } => {
                if len >= 3 {
                    self.events.push(EventStorage::Midi(make_midi_event(
                        offset,
                        [data[0], data[1], data[2]],
                    )));
                }
            }
        }
    }

    fn as_clap(&self) -> clap_input_events {
        clap_input_events {
            ctx: std::ptr::from_ref::<Self>(self)
                .cast::<std::ffi::c_void>()
                .cast_mut(),
            size: Some(input_events_size),
            get: Some(input_events_get),
        }
    }
}

unsafe extern "C" fn input_events_size(list: *const clap_input_events) -> u32 {
    let ctx = unsafe { (*list).ctx.cast::<ConvertedInputEvents>() };
    if ctx.is_null() {
        return 0;
    }
    u32::try_from(unsafe { (*ctx).events.len() }).unwrap_or(u32::MAX)
}

unsafe extern "C" fn input_events_get(
    list: *const clap_input_events,
    index: u32,
) -> *const clap_event_header {
    let ctx = unsafe { (*list).ctx.cast::<ConvertedInputEvents>() };
    if ctx.is_null() {
        return ptr::null();
    }
    let idx = index as usize;
    let events = unsafe { &(*ctx).events };
    events.get(idx).map_or(ptr::null(), EventStorage::header)
}

/// Sink for events the plugin emits during `process`.
struct OutputEventsSink<'a> {
    target: Option<&'a mut EventList>,
}

impl<'a> OutputEventsSink<'a> {
    fn new(target: Option<&'a mut EventList>) -> Self {
        Self { target }
    }

    fn as_clap(&mut self) -> clap_output_events {
        clap_output_events {
            ctx: std::ptr::from_mut::<Self>(self).cast::<std::ffi::c_void>(),
            try_push: Some(output_events_try_push),
        }
    }
}

unsafe extern "C" fn output_events_try_push(
    list: *const clap_output_events,
    event: *const clap_event_header,
) -> bool {
    if event.is_null() {
        return false;
    }
    let header = unsafe { &*event };
    let ctx = unsafe { (*list).ctx.cast::<OutputEventsSink<'_>>() };
    if ctx.is_null() {
        return true;
    }
    let target = unsafe { (*ctx).target.as_deref_mut() };
    let Some(target) = target else {
        // Plugin wanted to send an event; the host doesn't care
        // (Sink was constructed with `target: None`). Returning
        // true tells the plugin we accepted it.
        return true;
    };
    if let Some(rack_event) = unsafe { clap_event_to_rack(header) } {
        target.push(rack_event);
    }
    true
}

unsafe fn clap_event_to_rack(header: &clap_event_header) -> Option<truce_rack_core::events::Event> {
    use truce_rack_core::events::{Event, EventBody, MidiData};
    if header.space_id != CLAP_CORE_EVENT_SPACE_ID {
        return None;
    }
    let offset = header.time;
    match header.type_ {
        t if t == CLAP_EVENT_PARAM_VALUE => {
            let e: &clap_event_param_value =
                unsafe { &*std::ptr::from_ref::<clap_event_header>(header).cast() };
            Some(Event {
                sample_offset: offset,
                body: EventBody::ParamValue {
                    param_id: e.param_id,
                    value: e.value,
                },
            })
        }
        t if t == CLAP_EVENT_NOTE_ON => {
            let e: &clap_event_note =
                unsafe { &*std::ptr::from_ref::<clap_event_header>(header).cast() };
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let velocity = (e.velocity * 127.0).round().clamp(0.0, 127.0) as u8;
            Some(Event {
                sample_offset: offset,
                body: EventBody::Midi(MidiData::NoteOn {
                    channel: u8::try_from(e.channel.max(0)).unwrap_or(0),
                    note: u8::try_from(e.key.max(0)).unwrap_or(0),
                    velocity,
                }),
            })
        }
        t if t == CLAP_EVENT_NOTE_OFF => {
            let e: &clap_event_note =
                unsafe { &*std::ptr::from_ref::<clap_event_header>(header).cast() };
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let velocity = (e.velocity * 127.0).round().clamp(0.0, 127.0) as u8;
            Some(Event {
                sample_offset: offset,
                body: EventBody::Midi(MidiData::NoteOff {
                    channel: u8::try_from(e.channel.max(0)).unwrap_or(0),
                    note: u8::try_from(e.key.max(0)).unwrap_or(0),
                    velocity,
                }),
            })
        }
        t if t == CLAP_EVENT_MIDI => {
            let e: &clap_event_midi =
                unsafe { &*std::ptr::from_ref::<clap_event_header>(header).cast() };
            Some(Event {
                sample_offset: offset,
                body: EventBody::Midi(MidiData::Raw {
                    len: 3,
                    data: [e.data[0], e.data[1], e.data[2], 0, 0, 0, 0, 0],
                }),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_components() {
        assert_eq!(parse_version("1.2.3"), (1 << 16) | (2 << 8) | 3);
        assert_eq!(parse_version("0.5"), 5 << 8);
        assert_eq!(parse_version(""), 0);
    }

    #[test]
    fn bundle_binary_macos() {
        let p = bundle_binary_path(Path::new("/tmp/MyPlugin.clap"));
        #[cfg(target_os = "macos")]
        assert!(!p.exists() || p.starts_with("/tmp/MyPlugin.clap"));
        #[cfg(not(target_os = "macos"))]
        assert_eq!(p, Path::new("/tmp/MyPlugin.clap"));
    }
}

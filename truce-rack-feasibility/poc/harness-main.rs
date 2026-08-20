use std::path::Path;
use std::time::Instant;

use truce_rack::clap::ClapScanner;
use truce_rack::core::buffer::{AudioBuffer, BusRange};
use truce_rack::core::bus::BusLayout;
use truce_rack::core::events::EventList;
use truce_rack::core::info::PluginInfo;
use truce_rack::core::plugin::{Plugin, ProcessContext};
use truce_rack::core::scanner::PluginScanner;
use truce_rack::vst3::Vst3Scanner;

const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK: usize = 512;
const TOTAL_FRAMES: usize = SAMPLE_RATE as usize * 2;

struct HarnessResult {
    name: String,
    format: String,
    rms_ratio: f64,
    state_roundtrip: bool,
    param_display: String,
    avg_block_us: f64,
    max_block_us: f64,
}

fn main() {
    println!("=== truce-rack host integration PoC ===\n");

    let only: Option<String> = std::env::args().nth(1);

    let user_vst3 = Path::new(&std::env::var("LOCALAPPDATA").unwrap())
        .join("Programs/Common/VST3");
    let user_clap = Path::new(&std::env::var("LOCALAPPDATA").unwrap())
        .join("Programs/Common/CLAP");

    let mut vst3_infos = Vec::new();
    let mut clap_infos = Vec::new();

    if only.as_deref() != Some("clap") {
        println!("[scan] user VST3 dir: {}", user_vst3.display());
        vst3_infos = Vst3Scanner::new().scan_path(&user_vst3).unwrap_or_else(|e| {
            println!("  scan failed: {e}");
            Vec::new()
        });
        for info in &vst3_infos {
            println!("  found: {info}");
        }
    }

    if only.as_deref() != Some("vst3") {
        println!("[scan] user CLAP dir: {}", user_clap.display());
        clap_infos = ClapScanner::new().scan_path(&user_clap).unwrap_or_else(|e| {
            println!("  scan failed: {e}");
            Vec::new()
        });
        for info in &clap_infos {
            println!("  found: {info}");
        }
    }

    let mut results = Vec::new();

    for info in &vst3_infos {
        println!("\n[load] VST3 {}", info.name);
        match Vst3Scanner::new().load(info) {
            Ok(mut plugin) => {
                // VST3 wrapper speaks normalized [0,1]. nih-plug's skewed
                // range is power-law: plain = min + (max-min)*n^factor with
                // factor ~= 5.03 for the -30..+30 dB gain range, so linear
                // gain 0.5 sits at normalized ~= 0.4328.
                // set_parameter must run BEFORE activate: once processing
                // starts, IEditController::setParamNormalized is silently
                // dropped by the plugin and truce-rack never forwards
                // parameter events through inputParameterChanges.
                let r = run_dsp_suite(&mut plugin, info, 0.432_80, true);
                results.push(r);
            }
            Err(e) => println!("  LOAD FAILED: {e}"),
        }
        println!("[vst3 instance dropped]");
    }

    for info in &clap_infos {
        println!("\n[load] CLAP {}", info.name);
        match ClapScanner::new().load(info) {
            Ok(mut plugin) => {
                // CLAP param values are normalized [0,1] per the CLAP spec
                // (same value semantics as the VST3 wrapper). 0.4328 =
                // linear gain 0.5 for nih-plug's power-skewed -30..+30 dB
                // range. Params CAN be set after activate here: the
                // wrapper queues them and drains the queue inside
                // process() as CLAP param events.
                let r = run_dsp_suite(&mut plugin, info, 0.432_80, false);
                results.push(r);
            }
            Err(e) => println!("  LOAD FAILED: {e}"),
        }
        println!("[clap instance dropped]");
    }

    println!("\n=== summary ===");
    if results.is_empty() {
        println!("no plugins were loadable");
        return;
    }
    for r in &results {
        let pass = (r.rms_ratio - 0.5).abs() < 0.05 && r.state_roundtrip;
        println!(
            "[{}] {:>10} {:<20} ratio={:.4} state={} display='{}' block avg={:.1}us max={:.1}us",
            if pass { "PASS" } else { "FAIL" },
            r.format,
            r.name,
            r.rms_ratio,
            if r.state_roundtrip { "ok" } else { "FAIL" },
            r.param_display,
            r.avg_block_us,
            r.max_block_us,
        );
    }
}

fn run_dsp_suite<P: Plugin<f32>>(plugin: &mut P, info: &PluginInfo, target_gain: f64, set_before_activate: bool) -> HarnessResult {
    let mut name = info.name.clone();
    let format = info.format.to_string();
    let mut rms_ratio = f64::NAN;
    let mut state_ok = false;
    let mut param_display = String::new();
    let mut avg_block_us = 0.0;
    let mut max_block_us = 0.0;

    println!("  layouts: {}", plugin.supported_layouts().len());
    for (i, l) in plugin.supported_layouts().iter().enumerate() {
        println!(
            "    layout[{i}]: in={}ch out={}ch",
            l.total_input_channels(),
            l.total_output_channels()
        );
    }

    let stereo = plugin
        .supported_layouts()
        .iter()
        .find(|l| l.total_input_channels() == 2 && l.total_output_channels() == 2)
        .cloned()
        .unwrap_or_else(BusLayout::stereo);

    println!("  params: {}", plugin.parameter_count());
    let mut gain_index = None;
    for i in 0..plugin.parameter_count() {
        if let Ok(p) = plugin.parameter_info(i) {
            println!(
                "    param[{i}]: id={} '{}' [{}..{}] default={:.4} unit='{}'",
                p.id, p.name, p.min, p.max, p.default, p.unit
            );
            if p.name == "Gain" && gain_index.is_none() {
                gain_index = Some(i);
            }
        }
    }

    let Some(gi) = gain_index else {
        println!("  no 'Gain' parameter found; skipping DSP verify");
        return HarnessResult { name, format, rms_ratio, state_roundtrip: state_ok, param_display, avg_block_us, max_block_us };
    };

    // Value semantics are format-specific (normalized for VST3, plain for
    // CLAP); the caller passes the right one. Both aim at linear gain 0.5.
    if set_before_activate {
        // VST3 workaround: parameters only stick before setProcessing(true).
        if let Err(e) = plugin.set_parameter(gi, target_gain) {
            println!("  SET PARAM FAILED: {e}");
        }
    }

    if let Err(e) = plugin.activate(stereo, SAMPLE_RATE, BLOCK) {
        println!("  ACTIVATE FAILED: {e}");
        return HarnessResult { name, format, rms_ratio, state_roundtrip: state_ok, param_display, avg_block_us, max_block_us };
    }
    println!("  activated: stereo @ {SAMPLE_RATE}Hz, block {BLOCK}");

    if !set_before_activate {
        if let Err(e) = plugin.set_parameter(gi, target_gain) {
            println!("  SET PARAM FAILED: {e}");
        }
    }
    if let Ok(v) = plugin.parameter_value(gi) {
        println!("  gain now: {v:.4}");
    }
    if let Ok(s) = plugin.parameter_value_string(gi, target_gain) {
        println!("  gain display: '{s}'");
        param_display = s;
    }

    // ---- DSP pass: 2s of 1kHz sine at 0.5 amplitude, stereo ----
    let mut out_l = vec![0f32; TOTAL_FRAMES];
    let mut out_r = vec![0f32; TOTAL_FRAMES];
    let mut in_l = vec![0f32; TOTAL_FRAMES];
    let mut in_r = vec![0f32; TOTAL_FRAMES];
    let amplitude = 0.5f32;
    for n in 0..TOTAL_FRAMES {
        let t = n as f32 / SAMPLE_RATE as f32;
        let s = amplitude * (2.0 * std::f32::consts::PI * 1000.0 * t).sin();
        in_l[n] = s;
        in_r[n] = s;
    }

    let in_refs: Vec<&[f32]> = vec![&in_l, &in_r];
    let mut out_refs: Vec<&mut [f32]> = vec![&mut out_l, &mut out_r];
    let bus_in = [BusRange::new(0, 2)];
    let bus_out = [BusRange::new(0, 2)];

    let mut events = EventList::new();
    let mut output_events = EventList::new();
    let mut timing: Vec<f64> = Vec::new();

    for chunk_start in (0..TOTAL_FRAMES).step_by(BLOCK) {
        let end = (chunk_start + BLOCK).min(TOTAL_FRAMES);
        let frames = end - chunk_start;

        let chunk_in: Vec<&[f32]> = in_refs
            .iter()
            .map(|c| &c[chunk_start..end])
            .collect();
        let mut chunk_out: Vec<&mut [f32]> = out_refs
            .iter_mut()
            .map(|c| &mut c[chunk_start..end])
            .collect();

        let mut buffer = AudioBuffer::new(
            &chunk_in,
            &mut chunk_out,
            frames,
            &bus_in,
            &bus_out,
        );
        events.clear();
        output_events.clear();
        let mut context = ProcessContext {
            sample_rate: SAMPLE_RATE,
            max_block_size: BLOCK,
            transport: None,
            output_events: &mut output_events,
        };

        let t0 = Instant::now();
        match plugin.process(&mut buffer, &events, &mut context) {
            Ok(_) => {}
            Err(e) => println!("  PROCESS ERROR: {e}"),
        }
        let dt = t0.elapsed().as_secs_f64() * 1e6;
        timing.push(dt);
    }

    // RMS ratio over the final 500ms (smoothing settled: 50ms log ramp)
    let settle = TOTAL_FRAMES - SAMPLE_RATE as usize / 2;
    let rms = |buf: &[f32]| {
        (buf[settle..]
            .iter()
            .map(|x| (*x as f64) * (*x as f64))
            .sum::<f64>()
            / (buf.len() - settle) as f64)
            .sqrt()
    };
    let in_rms = (rms(&in_l) + rms(&in_r)) / 2.0;
    let out_rms = (rms(&out_l) + rms(&out_r)) / 2.0;
    rms_ratio = out_rms / in_rms;
    println!("  rms in={in_rms:.5} out={out_rms:.5} ratio={rms_ratio:.4} (expect ~0.5)");

    avg_block_us = timing.iter().sum::<f64>() / timing.len() as f64;
    max_block_us = timing.iter().cloned().fold(0.0, f64::max);
    println!("  block timing: avg={avg_block_us:.1}us max={max_block_us:.1}us (block={BLOCK} = {:.0}us)",
        BLOCK as f64 / SAMPLE_RATE * 1e6);

    // ---- state roundtrip ----
    match plugin.save_state() {
        Ok(bytes) => {
            println!("  state saved: {} bytes", bytes.len());
            // Change the gain, then restore and confirm it snaps back.
            let _ = plugin.set_parameter(gi, 1.0);
            let before = plugin.parameter_value(gi).unwrap_or(f64::NAN);
            match plugin.load_state(&bytes) {
                Ok(()) => {
                    let after = plugin.parameter_value(gi).unwrap_or(f64::NAN);
                    state_ok = (after - target_gain).abs() < 1e-3;
                    println!("  state roundtrip: {before:.4} -> {after:.4} ({})", if state_ok { "ok" } else { "MISMATCH" });
                }
                Err(e) => println!("  LOAD STATE FAILED: {e}"),
            }
        }
        Err(e) => println!("  SAVE STATE FAILED: {e}"),
    }

    plugin.deactivate();
    println!("  [suite done, deactivation ok]");
    let _ = &mut name;
    HarnessResult { name, format, rms_ratio, state_roundtrip: state_ok, param_display, avg_block_us, max_block_us }
}

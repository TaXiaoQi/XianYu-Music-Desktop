fn main() {
    // 图标文件变化时强制重新编译，确保 exe 中嵌入最新的图标资源
    println!("cargo:rerun-if-changed=icons/");
    tauri_build::build()
}

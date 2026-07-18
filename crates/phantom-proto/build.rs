fn main() {
    // Use a vendored protoc so the build does not depend on a system-installed
    // protoc (important on the Windows-only target where protoc may be absent).
    if std::env::var("PROTOC").is_err() {
        if let Ok(p) = protoc_bin_vendored::protoc_bin_path() {
            std::env::set_var("PROTOC", p);
        }
    }

    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let proto_dir = std::path::Path::new(&manifest).join("../../proto");
    let proto_file = proto_dir.join("phantom.proto");

    tonic_build::configure()
        .build_server(false) // Rust side is the gRPC client only
        .compile_protos(std::slice::from_ref(&proto_file), &[proto_dir])
        .expect("Failed to compile proto/phantom.proto");

    println!("cargo:rerun-if-changed={}", proto_file.display());
}

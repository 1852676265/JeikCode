// Minimal smoke: serve_stdio must exist and AcpServeOptions must be constructible.
#[test]
fn serve_stdio_symbol_exists() {
    // Compile-time proof the public surface exists; behavior covered in Task 11.
    let _f: fn(zap::acp::AcpServeOptions) -> _ = zap::acp::serve_stdio;
    let _opts = zap::acp::AcpServeOptions {
        engine: None,
        provider_factory: None,
        auto_approve: false,
    };
}

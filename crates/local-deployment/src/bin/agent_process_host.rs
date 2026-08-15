#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = local_deployment::process_host::run_from_stdin().await {
        eprintln!("agent process host failed: {error}");
        std::process::exit(1);
    }
}

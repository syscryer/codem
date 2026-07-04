fn main() {
    if let Err(error) = codem::backend::run_from_env_blocking() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

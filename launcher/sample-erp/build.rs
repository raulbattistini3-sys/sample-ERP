// rust-embed reads these folders when the crate compiles, but cargo only notices edits to files it
// already embedded. Watching the folders also picks up new and deleted files (a fresh vite build
// renames every hashed asset), so `cargo xtask dist` never ships a stale web app or migration list.
fn main() {
    for dir in ["../../web/dist", "../../api/drizzle", "../../docker/postgres/init"] {
        println!("cargo:rerun-if-changed={dir}");
    }
}

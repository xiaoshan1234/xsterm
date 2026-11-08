/// Convenience extension for converting errors into `String`.
pub trait StringError<T> {
    /// Map the error variant to its `String` representation.
    fn map_err_string(self) -> Result<T, String>;
}

impl<T, E> StringError<T> for Result<T, E>
where
    E: std::fmt::Display,
{
    fn map_err_string(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

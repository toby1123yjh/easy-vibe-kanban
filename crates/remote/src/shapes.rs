//! Shared shape metadata; PostgreSQL queries still validate in the remote crate.

pub use api_types::contracts::shapes::*;

macro_rules! validate_shapes {
    ($($name:ident: $row:ty {
        table: $table:literal, where_clause: $filter:literal,
        url: $url:literal, fallback_url: $fallback:literal,
        params: [$($param:literal),* $(,)?],
    })*) => {
        #[allow(dead_code)]
        fn validate_shape_queries() {
            $(let _ = sqlx::query!(
                "SELECT 1 AS v FROM " + $table + " WHERE " + $filter
                $(, { let _ = stringify!($param); uuid::Uuid::nil() })*
            );)*
        }
    };
}

api_types::for_each_shape_contract!(validate_shapes);

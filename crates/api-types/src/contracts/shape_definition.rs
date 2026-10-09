//! Shape infrastructure: struct, trait, and macro.

use std::marker::PhantomData;

use ts_rs::TS;

#[derive(Debug)]
pub struct ShapeDefinition<T: TS> {
    pub name: &'static str,
    pub table: &'static str,
    pub where_clause: &'static str,
    pub params: &'static [&'static str],
    pub url: &'static str,
    pub fallback_url: &'static str,
    pub _phantom: PhantomData<T>,
}

/// Trait to allow heterogeneous collection of shapes for export.
///
/// This enables collecting `ShapeDefinition<T>` values with different `T`
/// into a single `Vec<&dyn ShapeExport>`.
pub trait ShapeExport: Sync {
    fn name(&self) -> &'static str;
    fn table(&self) -> &'static str;
    fn where_clause(&self) -> &'static str;
    fn params(&self) -> &'static [&'static str];
    fn url(&self) -> &'static str;
    fn fallback_url(&self) -> &'static str;
    fn ts_type_name(&self) -> String;
}

impl<T: TS + Sync> ShapeExport for ShapeDefinition<T> {
    fn name(&self) -> &'static str {
        self.name
    }
    fn table(&self) -> &'static str {
        self.table
    }
    fn where_clause(&self) -> &'static str {
        self.where_clause
    }
    fn params(&self) -> &'static [&'static str] {
        self.params
    }
    fn url(&self) -> &'static str {
        self.url
    }
    fn fallback_url(&self) -> &'static str {
        self.fallback_url
    }
    fn ts_type_name(&self) -> String {
        T::name()
    }
}

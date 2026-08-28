use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub default_agent_working_dir: Option<String>,
    pub remote_project_id: Option<Uuid>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectListItem {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProjectCursor {
    pub updated_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProjectPage {
    pub projects: Vec<ProjectListItem>,
    pub next_cursor: Option<ProjectCursor>,
}

impl Project {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Project,
            r#"SELECT id as "id!: Uuid",
                      name,
                      default_agent_working_dir,
                      remote_project_id as "remote_project_id: Uuid",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM projects
               ORDER BY created_at DESC"#
        )
        .fetch_all(pool)
        .await
    }

    pub async fn set_remote_project_id(
        pool: &SqlitePool,
        id: Uuid,
        remote_project_id: Option<Uuid>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE projects
               SET remote_project_id = $2
               WHERE id = $1"#,
            id,
            remote_project_id
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn list_recent(
        pool: &SqlitePool,
        cursor: Option<ProjectCursor>,
        limit: u32,
    ) -> Result<ProjectPage, sqlx::Error> {
        let page_size = limit.clamp(1, 100) as i64;
        let mut query =
            QueryBuilder::<Sqlite>::new("SELECT id, name, created_at, updated_at FROM projects");
        if let Some(cursor) = cursor {
            query
                .push(" WHERE (julianday(updated_at) < julianday(")
                .push_bind(cursor.updated_at)
                .push(") OR (julianday(updated_at) = julianday(")
                .push_bind(cursor.updated_at)
                .push(") AND id > ")
                .push_bind(cursor.id)
                .push("))");
        }
        query
            .push(" ORDER BY julianday(updated_at) DESC, id ASC LIMIT ")
            .push_bind(page_size + 1);

        let mut projects = query
            .build_query_as::<ProjectListItem>()
            .fetch_all(pool)
            .await?;
        let has_more = projects.len() > page_size as usize;
        if has_more {
            projects.pop();
        }
        let next_cursor = has_more.then(|| {
            let last = projects
                .last()
                .expect("a paginated project page with more rows is non-empty");
            ProjectCursor {
                updated_at: last.updated_at,
                id: last.id,
            }
        });

        Ok(ProjectPage {
            projects,
            next_cursor,
        })
    }
}

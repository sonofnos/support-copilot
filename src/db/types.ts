import type { ColumnType, Generated } from "kysely";

export type UserRole = "admin" | "agent" | "customer";
export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface OrgsTable {
  id: Generated<string>;
  name: string;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface UsersTable {
  id: Generated<string>;
  org_id: string;
  email: string;
  password_hash: string;
  role: Generated<UserRole>;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface ArticlesTable {
  id: Generated<string>;
  org_id: string;
  title: string;
  body: string;
  tags: Generated<string[]>;
  qdrant_point_id: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | undefined, Date>;
}

export interface TicketsTable {
  id: Generated<string>;
  org_id: string;
  customer_id: string;
  assigned_agent_id: string | null;
  subject: string;
  status: Generated<TicketStatus>;
  priority: Generated<TicketPriority>;
  qdrant_point_id: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | undefined, Date>;
  resolved_at: Date | null;
}

export interface TicketMessagesTable {
  id: Generated<string>;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: ColumnType<Date, string | undefined, never>;
}

export interface WebhookEventsTable {
  id: Generated<string>;
  provider: string;
  provider_event_id: string;
  payload: unknown;
  processed_at: ColumnType<Date, string | undefined, never>;
}

export interface TicketStatsByOrgTable {
  org_id: string;
  open_count: string;
  resolved_count: string;
  avg_resolution_seconds: string | null;
}

export interface Database {
  orgs: OrgsTable;
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  articles: ArticlesTable;
  tickets: TicketsTable;
  ticket_messages: TicketMessagesTable;
  webhook_events: WebhookEventsTable;
  ticket_stats_by_org: TicketStatsByOrgTable;
}

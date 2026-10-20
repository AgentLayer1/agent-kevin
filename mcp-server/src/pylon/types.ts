/**
 * Pylon vendor shapes — the subset of fields we read, per the docs +
 * https://static.usepylon.com/openapi.json. All fields optional except `id`:
 * Pylon omits empties, and a projection must never crash on a missing key.
 */

export interface PylonEnvelope<T> {
  data?: T;
  pagination?: { cursor?: string; has_next_page?: boolean };
  request_id?: string;
}

export interface PylonIssue {
  id: string;
  number?: number;
  title?: string;
  body_html?: string;
  state?: string;
  type?: string;
  source?: string;
  link?: string;
  created_at?: string;
  updated_at?: string;
  latest_message_activity_at?: string;
  snoozed_until_time?: string;
  tags?: string[];
  account?: { id?: string };
  requester?: { id?: string; email?: string };
  assignee?: { id?: string; email?: string };
  team?: { id?: string };
  external_issues?: Array<{ source?: string; external_id?: string; link?: string }>;
  csat_responses?: Array<{ score?: number; comment?: string }>;
}

export interface PylonMessage {
  id: string;
  is_private?: boolean;
  message_html?: string;
  source?: string;
  thread_id?: string;
  timestamp?: string;
  author?: {
    name?: string;
    user?: { id?: string; email?: string };
    contact?: { id?: string; email?: string };
  };
  file_urls?: string[];
}

export interface PylonAccount {
  id: string;
  name?: string;
  domain?: string;
  domains?: string[];
  primary_domain?: string;
  type?: string;
  owner?: { id?: string; email?: string };
  tags?: string[];
  external_ids?: Array<{ label?: string; value?: string }>;
  is_disabled?: boolean;
  latest_customer_activity_time?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PylonUser {
  id: string;
  name?: string;
  email?: string;
  status?: string;
  role_id?: string;
}

export interface PylonTag {
  id: string;
  value?: string;
  hex_color?: string;
  object_type?: string;
}

export interface PylonMacro {
  id: string;
  name?: string;
  text_html?: string;
  text_type?: string;
  macro_group_id?: string;
  has_actions?: boolean;
  actions?: Array<{ type?: string }>;
  created_at?: string;
  updated_at?: string;
}

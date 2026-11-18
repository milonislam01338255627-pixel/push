create table if not exists customers(
  id serial primary key,
  email text unique not null,
  password_hash text not null,
  session_token text,
  plan text default 'free',
  monthly_limit int default 1000,
  sent_count int default 0,
  count_month text,
  created_at timestamptz default now()
);
create table if not exists apps(
  id text primary key,
  customer_id int references customers(id) on delete cascade,
  name text not null,
  api_key text unique not null,
  vapid_public text not null,
  vapid_private text not null,
  created_at timestamptz default now()
);
create table if not exists devices(
  id serial primary key,
  app_id text references apps(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique(app_id, endpoint)
);
create table if not exists notifications(
  id serial primary key,
  app_id text references apps(id) on delete cascade,
  title text, body text, sent int, failed int,
  created_at timestamptz default now()
);

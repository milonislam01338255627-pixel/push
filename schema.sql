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
alter table notifications add column if not exists url text;
alter table notifications add column if not exists image text;
alter table notifications add column if not exists clicks int default 0;
alter table customers add column if not exists plan_expires_at timestamptz;
update customers set plan_expires_at = now() + interval '2 days' where plan_expires_at is null;
create table if not exists payments(
  id serial primary key,
  customer_id int references customers(id) on delete cascade,
  plan_id text not null,
  amount int not null,
  sender text not null,
  trx_id text unique not null,
  status text default 'pending',
  created_at timestamptz default now()
);

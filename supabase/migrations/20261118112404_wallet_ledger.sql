create schema wallet;
revoke all on schema wallet from public, anon, authenticated;

create table wallet.ledgers (
  id uuid primary key,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  version integer not null default 0 check (version >= 0),
  invite_hash text unique,
  invite_until bigint,
  check ((invite_hash is null) = (invite_until is null))
);

create table wallet.members (
  ledger_id uuid not null references wallet.ledgers(id),
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  active boolean not null default true,
  joined_at bigint not null,
  primary key (ledger_id, user_id)
);

create index wallet_members_by_user on wallet.members(user_id, joined_at desc) where active;
create unique index wallet_one_owner on wallet.members(ledger_id) where role = 'owner';

alter table wallet.ledgers enable row level security;
alter table wallet.members enable row level security;
revoke all on all tables in schema wallet from public, anon, authenticated;

create table wallet.registration_limits (
  bucket text primary key,
  window_start bigint not null,
  attempts integer not null check (attempts > 0)
);

alter table wallet.registration_limits enable row level security;
revoke all on wallet.registration_limits from public, anon, authenticated;

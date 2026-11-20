-- Up Migration
CREATE TABLE orders (
  id           uuid PRIMARY KEY,
  service_date date        NOT NULL,
  no           integer     NOT NULL CHECK (no > 0),
  name         text        NOT NULL,
  qty          integer     NOT NULL CHECK (qty > 0),
  message      text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered    boolean     NOT NULL DEFAULT false,
  UNIQUE (service_date, no)
);
CREATE INDEX orders_service_date_idx ON orders (service_date);

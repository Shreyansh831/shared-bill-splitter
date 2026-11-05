CREATE TABLE homes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id       TEXT PRIMARY KEY,
  home_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL,
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position)
);
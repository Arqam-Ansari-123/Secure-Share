#!/bin/bash
# SecureShare — create the application role before any schema exists.
#
# Runs first inside the postgres container's /docker-entrypoint-initdb.d (files
# execute in alphabetical order, as the superuser $POSTGRES_USER).
#
# The role is created HERE rather than in a .sql file because the password comes
# from the environment, and pure SQL has no portable way to interpolate one.
# Keeping it out of the .sql files also means those files stay executable by any
# plain `psql -f` with no variable setup.
set -euo pipefail

APP_DB_PASSWORD="${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v pw="$APP_DB_PASSWORD" <<-'EOSQL'
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
            CREATE ROLE app_rw LOGIN;
        END IF;
    END $$;

    ALTER ROLE app_rw WITH PASSWORD :'pw';
EOSQL

echo "SecureShare: role app_rw ready"

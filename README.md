# Farm Hand Manager

Farm management and record keeping — web, phone, and tablet, from one codebase.

Farm Hand Manager tracks what happens on a farm: the animals, crops, land, equipment and
supplies, and the daily record of what was done to them. It is designed to cover
any kind of farming — livestock, row crops, market gardens, orchards, apiaries,
mixed operations — without schema changes for each new type.

## Status

Early design. No application code yet. The domain model is being settled first,
deliberately, because the schema is the expensive thing to change later.

See [docs/domain-model.md](docs/domain-model.md).

## Intended shape

- **Hosted**, not self-hosted. Farms sign in; they do not run a server.
- **Offline-first.** Records are entered in barns and fields with no signal, and
  sync when the device is back online.
- **One codebase**, three targets: responsive web app, wrapped for iOS and
  Android via Capacitor.

## Prior art

The domain model is closely modeled on [farmOS](https://farmos.org), an
established open-source farm management system. Farm Hand Manager differs in being a
hosted, cross-platform product rather than self-hosted Drupal software.

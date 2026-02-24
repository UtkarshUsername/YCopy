On every app update, in `service-worker.js` bump `CACHE_VERSION` so the new worker installs fresh assets and claims clients, and in `app.js` handle `controllerchange` to reload once.

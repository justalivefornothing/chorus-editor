# Chorus Editor

Multi-cursor collaborative code editor powered by a from-scratch **RGA sequence CRDT**. Syncs across tabs and peers; a lag/partition slider makes convergence visible.

## Why

Most collaborative editors hide the CRDT. This one puts it on the surface: introduce lag or a network partition and watch replicas converge (or temporarily diverge) in real time.

## Features

- RGA sequence CRDT implemented from scratch
- Multi-cursor editing
- Cross-tab / peer sync
- Controllable lag and partition for demos

## Run

```bash
npm install
npm run dev
npm test
```

## License

MIT

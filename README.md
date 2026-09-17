# Chorus Editor

A multi-cursor collaborative code editor powered by a from-scratch RGA sequence CRDT. Syncs across tabs and peers; a lag/partition slider makes convergence visible.

## Idea

Most collaborative editors hide the CRDT. This one puts it on the surface: you can introduce lag or a network partition and watch the replicas converge (or temporarily diverge) in real time.

## Features

- RGA sequence CRDT implemented from scratch
- Multi-cursor editing
- Cross-tab / peer sync
- Controllable lag and partition for demos

## Status

Core CRDT + editor surface present. See source / any PLAN for remaining polish.

## License

MIT

# template-fns

Put together good “basic” web app template-fns. Set up e2e tests with react-testing-library and jest

Start with “table” template fns - including observable “program” definitions for client and server for pagination

Then do Postgres utils- stuff to generate sql queries based on auto-generated zod schemas from tables

Come up with ideas for things to populate template-fns with. Auth flows, async workers w bullmq, sqs, Kafka and temporal, socketio w and w/o redis backend, mcp server

Then implement them. Should be a lot, including UI elements based on chakra, but expand-able

For now, note any dependencies (you’ll need to add this Postgres table for the queue to work) in jsdoc

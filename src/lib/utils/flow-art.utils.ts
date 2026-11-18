// Flow Mode generative artwork: public barrel.
//
// The implementation lives in focused modules under `./flow-art/` (types,
// rng, svg, per-category renderers, the WC editorial system). Consumers
// import from this one path so those modules can be reorganised without
// touching them.

export * from '#lib/utils/flow-art/index.ts';

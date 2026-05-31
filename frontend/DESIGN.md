# Frontend Design

## Timeline Rendering

The prototype uses a DOM-based timeline. It is easier to inspect, style with Tailwind, make accessible, and compose with React state. Canvas would become attractive for 10,000+ clips, dense waveforms, and virtualized drawing.

## State

Project state stores collaborative document data: project, tracks, clips, effects, transitions, and overlays. UI state stores selection, zoom, scroll, active tool, snap, and panel sizes. Playback state stores current time, play/pause, speed, volume, and mute.

## Undo/Redo

The command manager stores executable command objects. Each command has `execute` and `undo`; executing clears redo, undo pushes the command to redo, and max history is capped at 50.

## Optimistic Updates

Local actions update Zustand immediately and enqueue a command. API persistence can reconcile later with server events. If a remote operation has a later `serverSeq` for the same property, the server value wins and the UI can show an overwrite toast.

## Zoom and Snap

Timeline pixels are calculated as `ms * zoomLevel / 1000`. Snap candidates include nearby clip starts/ends and playhead time. Alt disables snap during drag.

## Large Projects

For 10,000 clips, render only visible time ranges and visible tracks, memoize clip blocks, move drag state outside React render loops, and draw waveform/thumbnail detail on canvas layers.

## Pusher and Zustand

Pusher hooks subscribe to private project events, translate operation payloads into store actions, and use `lastSeenServerSeq` for reconnect catch-up through `/operations?afterSeq=...`.

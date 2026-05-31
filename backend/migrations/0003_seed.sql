-- password for both users is: password123
INSERT INTO users (id, email, password_hash, name, avatar_url) VALUES
('018f0000-0000-7000-8000-000000000001', 'alice@cloudcut.test', '$argon2id$v=19$m=19456,t=2,p=1$HkF698OcRN0wBuzYpqO5LQ$DJxDbEHtNrB4cHuUwVdbJ3pVEhbKyYLE+OiI+bawDh4', 'Alice Editor', 'https://example.com/alice.png'),
('018f0000-0000-7000-8000-000000000002', 'bob@cloudcut.test', '$argon2id$v=19$m=19456,t=2,p=1$HkF698OcRN0wBuzYpqO5LQ$DJxDbEHtNrB4cHuUwVdbJ3pVEhbKyYLE+OiI+bawDh4', 'Bob Reviewer', 'https://example.com/bob.png');

INSERT INTO workspaces (id, name, slug, plan, owner_id) VALUES
('018f0000-0000-7000-8000-000000000010', 'Acme Studio', 'acme-studio', 'pro', '018f0000-0000-7000-8000-000000000001');

INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
('018f0000-0000-7000-8000-000000000010', '018f0000-0000-7000-8000-000000000001', 'owner'),
('018f0000-0000-7000-8000-000000000010', '018f0000-0000-7000-8000-000000000002', 'editor');

INSERT INTO projects (id, workspace_id, name, description, settings, created_by) VALUES
('018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000010', 'Launch Cut', 'Main launch video', '{"resolution":"1080p","fps":30,"aspect_ratio":"16:9"}', '018f0000-0000-7000-8000-000000000001'),
('018f0000-0000-7000-8000-000000000021', '018f0000-0000-7000-8000-000000000010', 'Social Teaser', 'Short social edit', '{"resolution":"720p","fps":30,"aspect_ratio":"9:16"}', '018f0000-0000-7000-8000-000000000001');

INSERT INTO assets (id, project_id, uploaded_by, type, original_url, status, metadata) VALUES
('018f0000-0000-7000-8000-000000000030', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000001', 'video', 'samples/intro.mp4', 'ready', '{"duration_ms":12000,"width":1920,"height":1080,"codec":"h264","audio_codec":"aac","file_size_bytes":12000000,"checksum":"seed-1"}'),
('018f0000-0000-7000-8000-000000000031', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000001', 'video', 'samples/demo.mp4', 'ready', '{"duration_ms":30000,"width":1920,"height":1080,"codec":"h264","audio_codec":"aac","file_size_bytes":45000000,"checksum":"seed-2"}'),
('018f0000-0000-7000-8000-000000000032', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000002', 'audio', 'samples/music.wav', 'ready', '{"duration_ms":45000,"codec":"pcm","file_size_bytes":8000000,"checksum":"seed-3"}');

INSERT INTO asset_variants (asset_id, type, url, metadata) VALUES
('018f0000-0000-7000-8000-000000000030', 'proxy', 'samples/intro_proxy.mp4', '{"height":720}'),
('018f0000-0000-7000-8000-000000000030', 'thumbnail_strip', 'samples/intro_strip.jpg', '{"interval_ms":5000,"frame_width":160,"frame_count":3}'),
('018f0000-0000-7000-8000-000000000032', 'waveform_data', 'samples/music_waveform.json', '{"sample_rate":44100,"channels":1}');

INSERT INTO tracks (id, project_id, type, label, order_index, color) VALUES
('018f0000-0000-7000-8000-000000000040', '018f0000-0000-7000-8000-000000000020', 'video', 'V1', 1, '#2563eb'),
('018f0000-0000-7000-8000-000000000041', '018f0000-0000-7000-8000-000000000020', 'video', 'V2', 2, '#7c3aed'),
('018f0000-0000-7000-8000-000000000042', '018f0000-0000-7000-8000-000000000020', 'audio', 'A1', 3, '#059669'),
('018f0000-0000-7000-8000-000000000043', '018f0000-0000-7000-8000-000000000020', 'audio', 'A2', 4, '#ea580c');

INSERT INTO clips (id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform) VALUES
('018f0000-0000-7000-8000-000000000050', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000040', '018f0000-0000-7000-8000-000000000030', 'Intro', 0, 0, 8000, 8000, '{"x":0,"y":0,"scale":1,"rotation":0,"opacity":1}'),
('018f0000-0000-7000-8000-000000000051', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000040', '018f0000-0000-7000-8000-000000000031', 'Product Demo A', 8500, 2000, 14500, 12500, '{"x":0,"y":0,"scale":1,"rotation":0,"opacity":1}'),
('018f0000-0000-7000-8000-000000000052', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000041', '018f0000-0000-7000-8000-000000000031', 'Overlay Detail', 5000, 15000, 22000, 7000, '{"x":120,"y":80,"scale":0.6,"rotation":0,"opacity":0.9}'),
('018f0000-0000-7000-8000-000000000053', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000042', '018f0000-0000-7000-8000-000000000032', 'Music Bed', 0, 0, 25000, 25000, '{"x":0,"y":0,"scale":1,"rotation":0,"opacity":1}'),
('018f0000-0000-7000-8000-000000000054', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000040', '018f0000-0000-7000-8000-000000000030', 'Outro', 22000, 8000, 12000, 4000, '{"x":0,"y":0,"scale":1,"rotation":0,"opacity":1}');

INSERT INTO clip_effects (clip_id, type, order_index, params, enabled) VALUES
('018f0000-0000-7000-8000-000000000051', 'brightness', 1, '{"value":0.05}', true),
('018f0000-0000-7000-8000-000000000051', 'contrast', 2, '{"value":1.2}', true),
('018f0000-0000-7000-8000-000000000052', 'blur', 1, '{"value":2}', false);

INSERT INTO transitions (project_id, from_clip_id, to_clip_id, type, duration_ms, params) VALUES
('018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000050', '018f0000-0000-7000-8000-000000000051', 'dissolve', 500, '{}');

INSERT INTO text_overlays (project_id, track_position_ms, duration_ms, content, animation) VALUES
('018f0000-0000-7000-8000-000000000020', 1000, 3500, 'CloudCut Launch', 'fade_in');

INSERT INTO export_jobs (id, project_id, requested_by, format, resolution, quality, status, progress_percent, idempotency_key) VALUES
('018f0000-0000-7000-8000-000000000060', '018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000001', 'mp4', '1080p', 'standard', 'queued', 0, 'seed-export-1');

INSERT INTO operation_logs (project_id, user_id, operation_type, payload, client_seq, server_seq) VALUES
('018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000001', 'clip.add', '{"clipId":"018f0000-0000-7000-8000-000000000050"}', 1, nextval('operation_server_seq')),
('018f0000-0000-7000-8000-000000000020', '018f0000-0000-7000-8000-000000000002', 'effect.update', '{"clipId":"018f0000-0000-7000-8000-000000000051","effect":"brightness"}', 1, nextval('operation_server_seq'));

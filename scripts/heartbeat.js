// Ensure it keeps playing to trigger "Active Media" state in the OS.
// External file: the MV3 extension CSP blocks the inline <script> heartbeat.html used to have.
const v = document.getElementById('heartbeatVideo');
v.play().catch(() => { /* Standard browser restriction handling */ });

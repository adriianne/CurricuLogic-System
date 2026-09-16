// config.js — shared Supabase configuration.
// Load this BEFORE auth.js, register.js, or studentdashboard.js.
//
// The anon key is public by design. It identifies the project, it does not
// grant access — Row Level Security is what protects the data. Keeping it
// in one file means rotating it is a single edit, not five.

window.CURRICULOGIC = {
    SUPABASE_URL: 'https://kibleqlooeaetpbelhve.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYmxlcWxvb2VhZXRwYmVsaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTM1NjMsImV4cCI6MjEwMTk2OTU2M30.9XPjRgJh3rEuuX-fV0ZrtRiUnahfP8yl8yerzoSsnLk',
};
# AgeWell waitlist

A standalone, responsive blue-and-white waitlist page, connected directly to the existing AgeWell Supabase project.

## Create your new repository

1. Extract the ZIP on your computer.
2. Create a new GitHub repository.
3. Choose **Add file > Upload files** and upload the extracted files, not the ZIP.
4. Ensure `index.html` is at the repository root, then commit the files.
5. Import the repository into Vercel as a new project. Choose **Other** as the framework; no build command is needed. The files at the repository root are the site.

No Node installation, build process, or private environment variables are required for this waitlist page. Internet access is required for fonts, Tailwind CSS, and Supabase.

## Database connection

The page contains the user-provided Supabase publishable key and calls the existing restricted `agewell_join_waitlist` function. This function is already installed in the connected AgeWell Supabase project. Do not replace the key with a secret or service-role key.

New signups and duplicate signups show a confirmation. Email and consent are saved to the existing database. Public visitors cannot retrieve saved records. The backend signup function caps new registrations at 100 per day across all pages using this project; this is basic abuse containment, not complete bot protection.

This repository contains only the waitlist page, not the AI care-plan generator. It does not send emails, reminders, or provide an active care service.

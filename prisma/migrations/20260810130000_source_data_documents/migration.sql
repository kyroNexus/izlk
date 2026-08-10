-- Keeps customer source materials separate from estimates and project files.
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'SOURCE_DATA';

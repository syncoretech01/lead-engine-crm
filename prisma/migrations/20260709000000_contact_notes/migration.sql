-- Free-text notes on a contact (shown on the record + in the peek view).
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "notes" TEXT;

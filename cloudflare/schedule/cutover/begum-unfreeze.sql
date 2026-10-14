-- Use only after reconciling destination writes; this does not restore frontend routing.
DROP TRIGGER migrated_begum_tasks ON public.schedule_manual_tasks;
DROP TRIGGER migrated_begum_transfers ON public.schedule_transfer_items;
DROP FUNCTION public.block_migrated_begum_schedule_writes();

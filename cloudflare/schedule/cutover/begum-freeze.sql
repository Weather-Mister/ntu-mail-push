CREATE FUNCTION public.block_migrated_begum_schedule_writes()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
 IF EXISTS (SELECT 1 FROM public.schedule_workspaces WHERE app_slug='begum' AND workspace_hash IN (CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.workspace_hash END, CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.workspace_hash END)) THEN
  RAISE EXCEPTION 'Begum schedule moved to Cloudflare. Reload the schedule site online and update the desktop widget before editing.' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.block_migrated_begum_schedule_writes() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER migrated_begum_tasks BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_manual_tasks FOR EACH ROW EXECUTE FUNCTION public.block_migrated_begum_schedule_writes();
CREATE TRIGGER migrated_begum_transfers BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_transfer_items FOR EACH ROW EXECUTE FUNCTION public.block_migrated_begum_schedule_writes();

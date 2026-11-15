-- The narrow one-time demo reset has completed. Remove its elevated helpers.
drop function public.prepare_demo_registration_reset(uuid, uuid, uuid);
drop function public.finish_demo_registration_reset(uuid, uuid, uuid, uuid[]);

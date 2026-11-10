BEGIN;

ALTER TABLE public.field_sales_settings
  ADD COLUMN roofing_appointments_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN roofing_appointment_writes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN roofing_reminders_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.field_appointments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  campaign_address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
  property_label text,
  created_by uuid REFERENCES auth.users(id),
  setter_id uuid REFERENCES auth.users(id),
  assignee_id uuid REFERENCES auth.users(id),
  appointment_type text NOT NULL CHECK (length(appointment_type) BETWEEN 1 AND 80),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled','confirmed','held','no_show','cancelled','legacy_unknown')),
  outcome_at timestamptz,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  cancellation_reason text,
  version integer NOT NULL DEFAULT 1,
  schedule_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,id)
);

CREATE INDEX field_appointments_assignee_schedule
  ON public.field_appointments(workspace_id,assignee_id,start_at,id);
CREATE INDEX field_appointments_workspace_schedule
  ON public.field_appointments(workspace_id,start_at,id);
CREATE INDEX field_appointments_contact ON public.field_appointments(contact_id);

CREATE TABLE public.field_appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  reason text,
  version integer NOT NULL,
  before_state jsonb,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,appointment_id) REFERENCES public.field_appointments(workspace_id,id),
  UNIQUE (appointment_id,version)
);

CREATE TABLE public.field_appointment_reminders (
  workspace_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  recipient_id uuid NOT NULL REFERENCES auth.users(id),
  schedule_version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('assignment','reschedule','upcoming')),
  due_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  dispatched_at timestamptz,
  FOREIGN KEY (workspace_id,appointment_id) REFERENCES public.field_appointments(workspace_id,id),
  PRIMARY KEY (appointment_id,recipient_id,schedule_version,kind)
);
CREATE INDEX field_appointment_reminders_due
  ON public.field_appointment_reminders(due_at)
  WHERE cancelled_at IS NULL AND dispatched_at IS NULL;

CREATE TABLE public.field_appointment_legacy_links (
  workspace_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('meeting','calendar','contact')),
  source_id uuid NOT NULL,
  evidence text NOT NULL CHECK (evidence IN ('explicit','unique_contact_time')),
  FOREIGN KEY (workspace_id,appointment_id) REFERENCES public.field_appointments(workspace_id,id),
  PRIMARY KEY (workspace_id,source_kind,source_id)
);

ALTER TABLE public.field_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_appointment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_appointment_legacy_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_appointments,public.field_appointment_events,
  public.field_appointment_reminders,public.field_appointment_legacy_links FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.field_appointment_manager(w uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id=w AND user_id=auth.uid() AND role IN ('owner','admin','manager')
  )
$$;

CREATE FUNCTION public.field_appointment_payload(a public.field_appointments) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT to_jsonb(a) || jsonb_build_object(
    'contact_name', c.full_name,
    'setter_name',coalesce(setter.raw_user_meta_data->>'full_name',setter.raw_user_meta_data->>'name'),
    'assignee_name',coalesce(assignee.raw_user_meta_data->>'full_name',assignee.raw_user_meta_data->>'name'),
    'can_update', a.assignee_id=auth.uid() OR public.field_appointment_manager(a.workspace_id),
    'can_assign', public.field_appointment_manager(a.workspace_id)
  )
  FROM public.contacts c
  LEFT JOIN auth.users setter ON setter.id=a.setter_id
  LEFT JOIN auth.users assignee ON assignee.id=a.assignee_id
  WHERE c.id=a.contact_id AND c.workspace_id=a.workspace_id
$$;

CREATE FUNCTION public.field_appointment_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  manager boolean;
  cfg public.field_sales_settings;
  req uuid := (p_data->>'request_id')::uuid;
  target uuid := (p_data->>'id')::uuid;
  previous public.field_sales_requests;
  before_row public.field_appointments;
  after_row public.field_appointments;
  contact_row public.contacts;
  target_contact_id uuid := (p_data->>'contact_id')::uuid;
  new_name text := nullif(trim(p_data->>'new_contact_name'),'');
  new_phone text := nullif(trim(p_data->>'new_contact_phone'),'');
  assignee uuid;
  setter uuid;
  campaign uuid;
  property uuid;
  contact_property uuid;
  property_label text;
  starts timestamptz;
  ends timestamptz;
  zone text;
  why text := nullif(trim(p_data->>'reason'),'');
  response jsonb;
  reminder_kind text;
BEGIN
  PERFORM public.field_sales_role(p_workspace);
  manager := public.field_appointment_manager(p_workspace);
  SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR SHARE;
  IF NOT coalesce(cfg.roofing_appointments_enabled AND cfg.roofing_appointment_writes_enabled,false) THEN
    RAISE EXCEPTION 'Appointment writes are unavailable for this workspace' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR req IS NULL OR target IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Appointment ID and request ID are required' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text||':'||actor::text||':'||req::text,0));
  SELECT * INTO previous FROM public.field_sales_requests
    WHERE workspace_id=p_workspace AND actor_id=actor AND request_id=req;
  IF FOUND THEN
    IF previous.action IS DISTINCT FROM ('appointment.'||p_action) OR previous.payload IS DISTINCT FROM p_data THEN
      RAISE EXCEPTION 'Request ID was used for different inputs' USING ERRCODE='22023';
    END IF;
    SELECT * INTO before_row FROM public.field_appointments WHERE id=target AND workspace_id=p_workspace;
    IF NOT FOUND OR NOT (manager OR coalesce(actor IN (before_row.assignee_id,before_row.setter_id,before_row.created_by),false)) THEN
      RAISE EXCEPTION 'Appointment unavailable' USING ERRCODE='42501';
    END IF;
    RETURN previous.result;
  END IF;

  IF p_action='book' THEN
    IF new_name IS NOT NULL THEN
      IF target_contact_id IS NULL OR length(new_name)>150 OR length(coalesce(new_phone,''))>100 THEN
        RAISE EXCEPTION 'A contact ID and valid name are required' USING ERRCODE='22023';
      END IF;
      property := nullif(p_data->>'campaign_address_id','')::uuid;
      campaign := nullif(p_data->>'campaign_id','')::uuid;
      SELECT a.formatted,a.campaign_id INTO property_label,campaign
      FROM public.campaign_addresses a JOIN public.campaigns c ON c.id=a.campaign_id
      WHERE a.id=property AND c.workspace_id=p_workspace AND (campaign IS NULL OR c.id=campaign)
        AND (manager OR public.can_view_campaign(c.id,actor));
      IF NOT FOUND THEN RAISE EXCEPTION 'Choose a linked property for the new contact' USING ERRCODE='42501'; END IF;
      INSERT INTO public.contacts(id,workspace_id,user_id,full_name,address,phone,campaign_id,address_id)
        VALUES(target_contact_id,p_workspace,actor,new_name,property_label,new_phone,campaign,property)
        RETURNING * INTO contact_row;
    ELSE
      SELECT * INTO contact_row FROM public.contacts c
        WHERE c.id=target_contact_id AND c.workspace_id=p_workspace AND (c.user_id=actor OR manager);
      IF NOT FOUND THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='42501'; END IF;
    END IF;
    assignee := coalesce(nullif(p_data->>'assignee_id','')::uuid,actor);
    IF assignee<>actor AND NOT manager THEN
      RAISE EXCEPTION 'Assignment permission required' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=assignee) THEN
      RAISE EXCEPTION 'Assignee must belong to the workspace' USING ERRCODE='22023';
    END IF;
    campaign := coalesce(nullif(p_data->>'campaign_id','')::uuid,contact_row.campaign_id);
    IF contact_row.campaign_id IS NOT NULL AND campaign IS DISTINCT FROM contact_row.campaign_id THEN
      RAISE EXCEPTION 'Campaign conflicts with the contact' USING ERRCODE='22023';
    END IF;
    IF campaign IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.campaigns WHERE id=campaign AND workspace_id=p_workspace
    ) THEN RAISE EXCEPTION 'Campaign unavailable' USING ERRCODE='42501'; END IF;
    contact_property := coalesce(
      nullif(to_jsonb(contact_row)->>'address_id','')::uuid,
      nullif(to_jsonb(contact_row)->>'campaign_address_id','')::uuid
    );
    property := coalesce(nullif(p_data->>'campaign_address_id','')::uuid,contact_property);
    IF property IS NOT NULL THEN
      SELECT a.formatted,a.campaign_id INTO property_label,campaign
        FROM public.campaign_addresses a JOIN public.campaigns c ON c.id=a.campaign_id
        WHERE a.id=property AND c.workspace_id=p_workspace AND (campaign IS NULL OR a.campaign_id=campaign);
      IF NOT FOUND THEN RAISE EXCEPTION 'Property unavailable in this campaign' USING ERRCODE='42501'; END IF;
      IF (contact_property IS NOT NULL AND contact_property<>property)
         OR (contact_property IS NULL AND
             lower(trim(coalesce(to_jsonb(contact_row)->>'address','')))<>lower(trim(property_label))) THEN
        RAISE EXCEPTION 'Property conflicts with the contact' USING ERRCODE='22023';
      END IF;
    ELSE
      property_label := nullif(to_jsonb(contact_row)->>'address','');
    END IF;
    starts := (p_data->>'start_at')::timestamptz;
    ends := coalesce((p_data->>'end_at')::timestamptz,starts+interval '60 minutes');
    zone := coalesce(nullif(p_data->>'timezone',''),cfg.timezone);
    IF starts IS NULL OR ends<=starts OR NOT isfinite(starts) OR NOT isfinite(ends) OR
       NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
      RAISE EXCEPTION 'Valid appointment times and timezone are required' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.field_appointments(
      id,workspace_id,contact_id,campaign_id,campaign_address_id,property_label,
      created_by,setter_id,assignee_id,appointment_type,start_at,end_at,timezone,status,notes
    ) VALUES (
      target,p_workspace,contact_row.id,campaign,property,property_label,
      actor,actor,assignee,coalesce(nullif(trim(p_data->>'appointment_type'),''),'Inspection'),
      starts,ends,zone,'scheduled',coalesce(p_data->>'notes','')
    ) RETURNING * INTO after_row;
    IF assignee<>actor THEN reminder_kind := 'assignment'; END IF;
  ELSE
    SELECT * INTO before_row FROM public.field_appointments
      WHERE id=target AND workspace_id=p_workspace FOR UPDATE;
    IF NOT FOUND OR NOT (manager OR coalesce(before_row.assignee_id=actor,false)) THEN
      RAISE EXCEPTION 'Appointment unavailable' USING ERRCODE='42501';
    END IF;
    IF (p_data->>'version')::integer IS DISTINCT FROM before_row.version THEN
      RETURN jsonb_build_object('conflict',true,'appointment',public.field_appointment_payload(before_row));
    END IF;
    after_row := before_row;
    IF p_action='correct_setter' THEN
      IF NOT manager OR why IS NULL THEN
        RAISE EXCEPTION 'Setter corrections require a manager and reason' USING ERRCODE='42501';
      END IF;
      setter := nullif(p_data->>'setter_id','')::uuid;
      IF setter IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=setter
      ) THEN RAISE EXCEPTION 'Setter must belong to the workspace' USING ERRCODE='22023'; END IF;
      after_row.setter_id := setter;
    ELSIF p_action='correct_outcome' THEN
      IF NOT manager OR why IS NULL THEN
        RAISE EXCEPTION 'Outcome corrections require a manager and reason' USING ERRCODE='42501';
      END IF;
      IF before_row.status NOT IN ('held','no_show','cancelled','legacy_unknown') OR
         coalesce(p_data->>'status','') NOT IN ('held','no_show','cancelled') OR
         (p_data->>'status' IN ('held','no_show') AND before_row.start_at>now()) THEN
        RAISE EXCEPTION 'Invalid outcome correction' USING ERRCODE='22023';
      END IF;
      after_row.status := p_data->>'status';
      after_row.outcome_at := now();
      after_row.cancellation_reason := CASE WHEN after_row.status='cancelled' THEN why END;
    ELSE
      IF before_row.status NOT IN ('scheduled','confirmed') THEN
        RAISE EXCEPTION 'This appointment already has an outcome' USING ERRCODE='22023';
      END IF;
      CASE p_action
        WHEN 'assign' THEN
          IF NOT manager THEN RAISE EXCEPTION 'Assignment permission required' USING ERRCODE='42501'; END IF;
          assignee := (p_data->>'assignee_id')::uuid;
          IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=assignee) THEN
            RAISE EXCEPTION 'Assignee must belong to the workspace' USING ERRCODE='22023';
          END IF;
          IF assignee IS DISTINCT FROM before_row.assignee_id THEN
            after_row.assignee_id := assignee;
            after_row.status := 'scheduled';
            reminder_kind := 'assignment';
          END IF;
        WHEN 'reschedule' THEN
          starts := (p_data->>'start_at')::timestamptz;
          ends := coalesce((p_data->>'end_at')::timestamptz,starts+(before_row.end_at-before_row.start_at));
          zone := coalesce(nullif(p_data->>'timezone',''),before_row.timezone);
          IF starts IS NULL OR ends<=starts OR NOT isfinite(starts) OR NOT isfinite(ends) OR
             NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
            RAISE EXCEPTION 'Valid appointment times and timezone are required' USING ERRCODE='22023';
          END IF;
          after_row.start_at := starts;
          after_row.end_at := ends;
          after_row.timezone := zone;
          after_row.status := 'scheduled';
          reminder_kind := 'reschedule';
        WHEN 'confirm' THEN
          after_row.status := 'confirmed';
        WHEN 'cancel' THEN
          IF why IS NULL OR length(why)>1000 THEN
            RAISE EXCEPTION 'Cancellation reason is required (maximum 1000 characters)' USING ERRCODE='22023';
          END IF;
          after_row.status := 'cancelled';
          after_row.outcome_at := now();
          after_row.cancellation_reason := why;
        WHEN 'held', 'no_show' THEN
          IF before_row.start_at>now() THEN
            RAISE EXCEPTION 'The appointment has not started' USING ERRCODE='22023';
          END IF;
          after_row.status := p_action;
          after_row.outcome_at := now();
        ELSE RAISE EXCEPTION 'Unknown appointment action' USING ERRCODE='22023';
      END CASE;
    END IF;
    IF reminder_kind IS NOT NULL OR after_row.status IN ('held','no_show','cancelled') THEN
      after_row.schedule_version := before_row.schedule_version+1;
      UPDATE public.field_appointment_reminders SET cancelled_at=now()
        WHERE appointment_id=target AND cancelled_at IS NULL;
    END IF;
    UPDATE public.field_appointments SET
      assignee_id=after_row.assignee_id,setter_id=after_row.setter_id,status=after_row.status,
      start_at=after_row.start_at,end_at=after_row.end_at,timezone=after_row.timezone,
      outcome_at=after_row.outcome_at,cancellation_reason=after_row.cancellation_reason,
      schedule_version=after_row.schedule_version,version=version+1,updated_at=now()
      WHERE id=target AND workspace_id=p_workspace RETURNING * INTO after_row;
  END IF;

  IF after_row.start_at>now() AND after_row.assignee_id IS NOT NULL AND
     (p_action='book' OR reminder_kind IS NOT NULL) THEN
    INSERT INTO public.field_appointment_reminders(workspace_id,appointment_id,recipient_id,schedule_version,kind,due_at)
      VALUES (p_workspace,target,after_row.assignee_id,after_row.schedule_version,
              'upcoming',greatest(now(),after_row.start_at-interval '1 hour'));
    IF reminder_kind IS NOT NULL THEN
      INSERT INTO public.field_appointment_reminders(workspace_id,appointment_id,recipient_id,schedule_version,kind,due_at)
        VALUES (p_workspace,target,after_row.assignee_id,after_row.schedule_version,reminder_kind,now());
    END IF;
  END IF;
  INSERT INTO public.field_appointment_events(workspace_id,appointment_id,actor_id,action,reason,version,before_state,after_state)
    VALUES (p_workspace,target,actor,p_action,why,after_row.version,
            CASE WHEN before_row.id IS NOT NULL THEN to_jsonb(before_row) END,to_jsonb(after_row));
  response := jsonb_build_object('id',target,'version',after_row.version,'status',after_row.status);
  INSERT INTO public.field_sales_requests(workspace_id,actor_id,request_id,action,payload,result)
    VALUES (p_workspace,actor,req,'appointment.'||p_action,p_data,response);
  RETURN response;
END
$$;

CREATE FUNCTION public.field_appointment_list(
  p_workspace uuid,p_start timestamptz DEFAULT NULL,p_end timestamptz DEFAULT NULL,
  p_contact uuid DEFAULT NULL,p_team boolean DEFAULT false,p_after_start timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  manager boolean;
  cfg public.field_sales_settings;
  appointments jsonb;
BEGIN
  PERFORM public.field_sales_role(p_workspace);
  manager := public.field_appointment_manager(p_workspace);
  IF p_team AND NOT manager THEN RAISE EXCEPTION 'Team access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
  SELECT coalesce(jsonb_agg(public.field_appointment_payload(a) ORDER BY a.start_at,a.id),'[]')
    INTO appointments
    FROM (
      SELECT fa.* FROM public.field_appointments fa
      WHERE fa.workspace_id=p_workspace AND (p_team OR fa.assignee_id=actor OR fa.setter_id=actor)
        AND (p_start IS NULL OR fa.end_at>p_start) AND (p_end IS NULL OR fa.start_at<p_end)
        AND (p_contact IS NULL OR fa.contact_id=p_contact)
        AND (p_after_start IS NULL OR (fa.start_at,fa.id)>(p_after_start,p_after_id))
      ORDER BY fa.start_at,fa.id LIMIT 100
    ) a;
  RETURN jsonb_build_object(
    'enabled',coalesce(cfg.roofing_appointments_enabled,false),
    'can_write',coalesce(cfg.roofing_appointments_enabled AND cfg.roofing_appointment_writes_enabled,false),
    'can_assign',manager,'timezone',cfg.timezone,'appointments',appointments
  );
END
$$;

CREATE FUNCTION public.field_appointment_detail(p_workspace uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  row public.field_appointments;
  history jsonb;
BEGIN
  PERFORM public.field_sales_role(p_workspace);
  SELECT * INTO row FROM public.field_appointments WHERE workspace_id=p_workspace AND id=p_id;
  IF NOT FOUND OR NOT (public.field_appointment_manager(p_workspace) OR
      coalesce(auth.uid() IN (row.assignee_id,row.setter_id,row.created_by),false)) THEN
    RAISE EXCEPTION 'Appointment unavailable' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'action',e.action,'actor_id',e.actor_id,'reason',e.reason,'occurred_at',e.occurred_at,
    'actor_name',coalesce(actor.raw_user_meta_data->>'full_name',actor.raw_user_meta_data->>'name'),
    'assignee_name',coalesce(assignee.raw_user_meta_data->>'full_name',assignee.raw_user_meta_data->>'name'),
    'setter_name',coalesce(setter.raw_user_meta_data->>'full_name',setter.raw_user_meta_data->>'name'),
    'start_at',e.after_state->'start_at','assignee_id',e.after_state->'assignee_id',
    'setter_id',e.after_state->'setter_id','status',e.after_state->'status'
  ) ORDER BY e.version),'[]') INTO history
  FROM public.field_appointment_events e
  LEFT JOIN auth.users actor ON actor.id=e.actor_id
  LEFT JOIN auth.users assignee ON assignee.id=(e.after_state->>'assignee_id')::uuid
  LEFT JOIN auth.users setter ON setter.id=(e.after_state->>'setter_id')::uuid
  WHERE e.workspace_id=p_workspace AND e.appointment_id=p_id;
  RETURN public.field_appointment_payload(row)||jsonb_build_object('history',history);
END
$$;

CREATE FUNCTION public.field_appointment_options(p_workspace uuid,p_search text DEFAULT '',p_address uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  manager boolean;
  contacts jsonb;
  reps jsonb;
BEGIN
  PERFORM public.field_sales_role(p_workspace);
  manager := public.field_appointment_manager(p_workspace);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name,'address',to_jsonb(c)->>'address')
                           ORDER BY c.full_name,c.id),'[]') INTO contacts
  FROM (
    SELECT * FROM public.contacts c
    WHERE c.workspace_id=p_workspace AND (manager OR c.user_id=actor)
      AND (p_address IS NULL OR EXISTS (
        SELECT 1 FROM public.campaign_addresses ca JOIN public.campaigns cp ON cp.id=ca.campaign_id
        WHERE ca.id=p_address AND cp.workspace_id=p_workspace
          AND (c.campaign_id IS NULL OR c.campaign_id=ca.campaign_id)
          AND coalesce(
            coalesce(to_jsonb(c)->>'address_id',to_jsonb(c)->>'campaign_address_id')=ca.id::text,
            lower(trim(to_jsonb(c)->>'address'))=lower(trim(ca.formatted))
          )
      ))
      AND strpos(lower(coalesce(c.full_name,'')||' '||coalesce(to_jsonb(c)->>'address','')),
                 lower(left(trim(coalesce(p_search,'')),200)))>0
    ORDER BY c.full_name,c.id LIMIT 50
  ) c;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(
     nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),'Representative'
   )) ORDER BY u.id),'[]') INTO reps
  FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id
  WHERE m.workspace_id=p_workspace AND (manager OR u.id=actor);
  RETURN jsonb_build_object('contacts',contacts,'representatives',reps,'actor_id',actor);
END
$$;

CREATE FUNCTION public.field_appointment_legacy_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  old_data jsonb := CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END;
  new_data jsonb := CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
  old_workspace uuid;
  new_workspace uuid;
BEGIN
  IF TG_TABLE_NAME='contact_activities' THEN
    IF old_data->>'type'='meeting' THEN
      SELECT workspace_id INTO old_workspace FROM public.contacts WHERE id=(old_data->>'contact_id')::uuid;
    END IF;
    IF new_data->>'type'='meeting' THEN
      SELECT workspace_id INTO new_workspace FROM public.contacts WHERE id=(new_data->>'contact_id')::uuid;
    END IF;
  ELSIF TG_TABLE_NAME='calendar_events' THEN
    IF old_data->>'event_type'='appointment' THEN
      old_workspace := (old_data->>'workspace_id')::uuid;
      IF old_workspace IS NULL THEN
        SELECT workspace_id INTO old_workspace FROM public.contacts WHERE id=(old_data->>'contact_id')::uuid;
      END IF;
    END IF;
    IF new_data->>'event_type'='appointment' THEN
      new_workspace := (new_data->>'workspace_id')::uuid;
      IF new_workspace IS NULL THEN
        SELECT workspace_id INTO new_workspace FROM public.contacts WHERE id=(new_data->>'contact_id')::uuid;
      END IF;
    END IF;
  ELSIF TG_OP<>'DELETE' AND
    ((old_data->>'appointment_at') IS DISTINCT FROM (new_data->>'appointment_at')
     OR (old_data->>'appointment_title') IS DISTINCT FROM (new_data->>'appointment_title')
     OR (old_data->>'appointment_notes') IS DISTINCT FROM (new_data->>'appointment_notes')
     OR (old_data->>'appointment_location') IS DISTINCT FROM (new_data->>'appointment_location')) THEN
    old_workspace := (old_data->>'workspace_id')::uuid;
    new_workspace := (new_data->>'workspace_id')::uuid;
  END IF;
  IF EXISTS (SELECT 1 FROM public.field_sales_settings
     WHERE workspace_id IN (old_workspace,new_workspace) AND roofing_appointments_enabled) THEN
    RAISE EXCEPTION 'Update WolfGrid to manage appointments in this workspace' USING ERRCODE='0A000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.field_calendar_can_write(
  p_workspace uuid,p_user uuid,p_contact uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
    AND (p_workspace IS NULL AND auth.uid()=p_user
      OR p_workspace IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id=p_workspace AND m.user_id=auth.uid()
          AND (p_user=auth.uid() OR m.role IN ('owner','admin','manager'))
      ))
    AND (p_contact IS NULL OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id=p_contact AND c.workspace_id IS NOT DISTINCT FROM p_workspace
        AND (c.user_id=auth.uid() OR public.field_appointment_manager(p_workspace))
    ))
$$;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Calendar events are insertable by owner or workspace members" ON public.calendar_events;
DROP POLICY IF EXISTS "Calendar events are updatable by owner or workspace members" ON public.calendar_events;
CREATE POLICY field_calendar_insert ON public.calendar_events FOR INSERT TO authenticated
  WITH CHECK (public.field_calendar_can_write(workspace_id,user_id,contact_id));
CREATE POLICY field_calendar_update ON public.calendar_events FOR UPDATE TO authenticated
  USING (public.field_calendar_can_write(workspace_id,user_id,NULL))
  WITH CHECK (public.field_calendar_can_write(workspace_id,user_id,contact_id));
CREATE POLICY field_calendar_delete ON public.calendar_events FOR DELETE TO authenticated
  USING (public.field_calendar_can_write(workspace_id,user_id,NULL));
CREATE POLICY field_calendar_restrict_insert ON public.calendar_events AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.field_calendar_can_write(workspace_id,user_id,contact_id));
CREATE POLICY field_calendar_restrict_update ON public.calendar_events AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.field_calendar_can_write(workspace_id,user_id,NULL))
  WITH CHECK (public.field_calendar_can_write(workspace_id,user_id,contact_id));
CREATE POLICY field_calendar_restrict_delete ON public.calendar_events AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.field_calendar_can_write(workspace_id,user_id,NULL));
REVOKE ALL ON FUNCTION public.field_calendar_can_write(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_calendar_can_write(uuid,uuid,uuid) TO authenticated;

CREATE TRIGGER field_appointment_guard_activities BEFORE INSERT OR UPDATE OR DELETE
  ON public.contact_activities FOR EACH ROW EXECUTE FUNCTION public.field_appointment_legacy_write_guard();
CREATE TRIGGER field_appointment_guard_calendar BEFORE INSERT OR UPDATE OR DELETE
  ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.field_appointment_legacy_write_guard();
CREATE TRIGGER field_appointment_guard_contacts BEFORE INSERT OR UPDATE
  ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.field_appointment_legacy_write_guard();

REVOKE ALL ON FUNCTION public.field_appointment_manager(uuid),
  public.field_appointment_payload(public.field_appointments),public.field_appointment_legacy_write_guard()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.field_appointment_command(uuid,text,jsonb),
  public.field_appointment_list(uuid,timestamptz,timestamptz,uuid,boolean,timestamptz,uuid),
  public.field_appointment_detail(uuid,uuid),public.field_appointment_options(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_appointment_command(uuid,text,jsonb),
  public.field_appointment_list(uuid,timestamptz,timestamptz,uuid,boolean,timestamptz,uuid),
  public.field_appointment_detail(uuid,uuid),public.field_appointment_options(uuid,text,uuid) TO authenticated;

COMMIT;

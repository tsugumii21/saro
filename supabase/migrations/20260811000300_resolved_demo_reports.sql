-- Idempotent resolved fixtures for the admin Resolved filter and timeline UI.
do $$
declare
  fixture record;
  v_report_id uuid;
begin
  for fixture in
    select * from (values
      ('medical', 'Resolved demo: patient assessed and transported from Bonot to the city hospital.', 13.1502, 123.7487, 'demo_resolved_medical_2026', 30, 8, 'patient_transported', 'LZ-AMB-2026-0811-17'),
      ('accident', 'Resolved demo: minor collision cleared at Taysan; injured rider endorsed to Ambulance 2.', 13.1203, 123.7104, 'demo_resolved_accident_2026', 22, 5, 'turned_over_to_unit', 'LZ-911-2026-0811-31'),
      ('crime', 'Resolved demo: Rawis public disturbance attended and entered in the police blotter.', 13.1607, 123.7507, 'demo_resolved_crime_2026', 16, 3, 'attended_no_action', 'PNP-LZ-BLOTTER-0811-09')
    ) as rows(category, description, lat, lng, device_id, created_age_hours, resolved_age_hours, reason, reference)
  loop
    if exists (select 1 from public.reports where reporter_device_id = fixture.device_id) then
      continue;
    end if;

    insert into public.reports (
      category, description, lat, lng, reporter_device_id, created_at,
      resolution_reason, resolution_reference
    ) values (
      fixture.category, fixture.description, fixture.lat, fixture.lng, fixture.device_id,
      now() - make_interval(hours => fixture.created_age_hours),
      fixture.reason::public.resolution_reason, fixture.reference
    ) returning id into v_report_id;

    update public.reports set status = 'assigned' where id = v_report_id;
    update public.reports set status = 'in_progress' where id = v_report_id;
    update public.reports set status = 'resolved' where id = v_report_id;
    update public.reports
       set resolved_at = now() - make_interval(hours => fixture.resolved_age_hours)
     where id = v_report_id;

    update public.report_status_history
       set changed_at = now() - make_interval(hours => fixture.resolved_age_hours)
     where report_status_history.report_id = v_report_id and status = 'resolved';
  end loop;
end $$;

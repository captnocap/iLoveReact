# CropDuster Site Manager

<position>
  <ref>position.cropduster_site_manager</ref>
  <name>CropDuster Site Manager</name>

  <fact key="business" label="Business" visibility="public">@[biz.cropduster_labs]</fact>
  <fact key="workplace" label="Workplace" visibility="public">@[place.east_mercer_depot]</fact>
  <fact key="occupant" label="Current occupant" visibility="public">@[npc.rowena_pike]</fact>
  <fact key="shift" label="Duty window" visibility="author">@[shift.cropduster_weekday_day]</fact>
  <fact key="access" label="Access" visibility="secret">restricted chemical storage keys</fact>

  <public>
The site manager coordinates CropDuster Labs crews and municipal service calls from the East Mercer Depot.
  </public>
</position>

<notes>
Missions bind to this stable position when the role matters more than its current
occupant. Changing who holds the job does not invalidate mission references.
</notes>

# CropDuster Weekday Day Shift

<shift>
  <ref>shift.cropduster_weekday_day</ref>
  <name>CropDuster Weekday Day Shift</name>

  <fact key="position" label="Position" visibility="author">@[position.cropduster_site_manager]</fact>
  <fact key="days" label="Days" visibility="author">mon,tue,wed,thu,fri</fact>
  <fact key="starts" label="Starts" visibility="author">08:00</fact>
  <fact key="ends" label="Ends" visibility="author">17:00</fact>
  <fact key="timezone" label="World timezone" visibility="author">city.local</fact>

  <public>
  </public>
</shift>

<notes>
This establishes a queryable recurring duty window without starting one timer
per worker. A later calendar compiler owns weeks, days, overnight wrapping, and
the frozen-world query indexes.
</notes>

# Homerun

Company application forms on `*.homerun.co`. The vacancy page and the apply steps are the same host. Count an application only when step 4 says it was submitted.

```tree
follow: reached success

node vacancy
  see: homerun.co vacancy page, no /apply in the path
  branch reached | Apply | personal

node personal
  see: /apply step=1, Upload your resume
  branch reached | Next: Questions after one resume shows status success | questions
  branch retry | the file input file list stays empty while the form shows no resume | personal

node questions
  see: /apply step=2, Yes and No answer buttons
  branch reached | Next: Preview | preview

node preview
  see: /apply step=3, Is the information you have submitted correct
  branch success | the visible Submit your application button, then step 4 | submitted

node submitted
  see: step=4 and Your application has been submitted
  action: success
  branch success | leave the confirmation | submitted
```

The resume control is `#resume_files`. It stays `display: none`. `DOM.setFileInputFiles` can leave `files.length` at 0 while the form still lists the file with status `success`. Keep one successful resume. The Yes and No controls are `button.answer-button`. Match them by the button `name`, because the nearest `div` is only the button cell. A hidden consent input is not the submit control. Use the visible Submit button on the preview step.

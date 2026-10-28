# WUR

Wageningen University & Research vacancies. The apply form is on the vacancy page. The site says only applications sent through that form are considered.

```tree
follow: reached success

node vacancy
  see: www.wur.nl/en/vacancy/
  branch reached | Apply now, or Apply for this job | form

node form
  see: ub-apply-form-content, step 1 of 2, personal data
  branch reached | Next step after the privacy box is clicked | uploads
  branch retry | the privacy box was set without a click | form

node uploads
  see: step 2 of 2, CV and motivational letter
  branch success | Apply, then the form contains ub-form-submitted | submitted

node submitted
  see: ub-form-submitted and Thanks for your application
  action: success
  branch success | leave the confirmation | submitted
```

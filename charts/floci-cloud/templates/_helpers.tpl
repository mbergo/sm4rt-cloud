{{- define "floci-cloud.consoleHost" -}}
{{- if .Values.console.ingress.host }}{{ .Values.console.ingress.host }}{{- else }}cloud.{{ .Values.instanceDomain }}{{- end }}
{{- end }}

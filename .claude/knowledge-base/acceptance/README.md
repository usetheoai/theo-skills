Registros de aceitação (cycle-acceptance). Um arquivo por milestone:
  {milestone}-{YYYY-MM-DD}.md  — critérios, resultado por critério, evidências, veredito
  evidence/                    — capturas, console, rede, transcrições citadas pelo registro

O veredito é COMPUTADO por compute_acceptance_verdict.py, nunca afirmado pelo agente que
rodou as jornadas. Um critério 'passed' sem evidência é recusado como NOT_VALIDATED.

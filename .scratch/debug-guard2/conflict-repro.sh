#!/bin/bash
# No-conflict check: pi-guard-extension (git install) uses guard_mode_*
# tools while @narumitw/pi-plan-mode (npm install) uses plan_mode_*.
# After ADR-0011 the two extensions must never register the same tool name,
# otherwise the pi host silently drops the later registration.
GUARD=${GUARD:-/home/shial/Project/Pi/guard/pi-guard-extension/src}
PLANMODE=${PLANMODE:-/home/shial/.pi/agent/npm/node_modules/@narumitw/pi-plan-mode/src}

# Extract the tool-name *values* (not the constant declarations) so a
# regression that keeps the new constant name but reverts the value is
# still caught.
tool_value() {
  grep -ho "$1 = \"[^\"]*\"" "$2"/*.ts | head -1 | sed 's/.*= "\(.*\)"/\1/'
}

q1=$(tool_value 'GUARD_MODE_QUESTION_TOOL_NAME' "$GUARD")
c1=$(tool_value 'GUARD_MODE_COMPLETE_TOOL_NAME' "$GUARD")
q2=$(tool_value 'PLAN_MODE_QUESTION_TOOL_NAME' "$PLANMODE")
c2=$(tool_value 'PLAN_MODE_COMPLETE_TOOL_NAME' "$PLANMODE")

echo "guard:     $q1 | $c1"
echo "plan-mode: $q2 | $c2"

# guard must register guard_mode_* tools (not plan_mode_*)
if [ "$q1" != "guard_mode_question" ] || [ "$c1" != "guard_mode_complete" ]; then
  echo "CONFLICT-DETECTED: guard tools are not registered as guard_mode_*"
  exit 1
fi
# pi-plan-mode must register plan_mode_* tools (not guard_mode_*)
if [ "$q2" != "plan_mode_question" ] || [ "$c2" != "plan_mode_complete" ]; then
  echo "CONFLICT-DETECTED: plan-mode tools are not registered as plan_mode_*"
  exit 1
fi
# the two tool-name sets must be disjoint (guards against both flipping)
if [ "$q1" = "$q2" ] || [ "$c1" = "$c2" ]; then
  echo "CONFLICT-DETECTED: same tool names registered by both extensions"
  exit 1
fi
echo "NO-CONFLICT"
exit 0

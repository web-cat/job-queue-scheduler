#!/usr/bin/env bash
set -euo pipefail

# Creates a sample Java submission with a true folder structure (subdirectories)
# and writes a zip archive next to this script:
#   test-graders/java8/sample-submission-java8.zip
#
# Notes:
# - These Java files intentionally use the *default package* (no `package ...;`)
#   so the existing Java8 test grader (TestRunner) can still load `Calculator`
#   via Class.forName("Calculator") even when sources live in subfolders.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ZIP="${OUT_ZIP:-$SCRIPT_DIR/sample-submission-java8.zip}"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR/sample-submission-java8}"

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' is required (install it, or create the zip manually)." >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/src/core" "$WORK_DIR/src/util" "$WORK_DIR/tests"

cat >"$WORK_DIR/src/core/Calculator.java" <<'EOF'
public class Calculator {
  public static int add(int a, int b) { return a + b; }
  public static int sub(int a, int b) { return a - b; }
}
EOF

cat >"$WORK_DIR/src/core/AdvancedCalculator.java" <<'EOF'
public class AdvancedCalculator {
  public static int mul(int a, int b) { return a * b; }
  public static int abs(int x) { return x < 0 ? -x : x; }
}
EOF

cat >"$WORK_DIR/src/util/NumberUtils.java" <<'EOF'
public class NumberUtils {
  public static boolean isEven(int n) { return (n % 2) == 0; }
}
EOF

cat >"$WORK_DIR/src/util/StringUtils.java" <<'EOF'
public class StringUtils {
  public static String repeat(String s, int n) {
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < n; i++) b.append(s);
    return b.toString();
  }
}
EOF

cat >"$WORK_DIR/tests/CalculatorTest.java" <<'EOF'
public class CalculatorTest {
  public static void main(String[] args) {
    // This file is just here to simulate student-provided tests in a folder structure.
    // The platform's Java8 test grader uses its own TestRunner.java.
    if (Calculator.add(2, 3) != 5) System.exit(1);
    if (Calculator.sub(7, 4) != 3) System.exit(1);
    System.out.println("OK");
  }
}
EOF

cat >"$WORK_DIR/README.txt" <<'EOF'
Sample folder-structured Java submission for the execution service.
EOF

rm -f "$OUT_ZIP"
(cd "$WORK_DIR" && zip -qr "$OUT_ZIP" .)

echo "Wrote: $OUT_ZIP"

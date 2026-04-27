public class TestRunner {
  private static int passed = 0;
  private static int total = 0;
  private static StringBuilder log = new StringBuilder();

  private static void assertEq(String name, int actual, int expected) {
    total++;
    if (actual == expected) {
      passed++;
      log.append("PASS ").append(name).append("\n");
    } else {
      log.append("FAIL ").append(name).append(" expected=").append(expected).append(" actual=").append(actual).append("\n");
    }
  }

  public static void main(String[] args) throws Exception {
    // Expect Calculator with static add/sub methods.
    Class<?> c = Class.forName("Calculator");
    int a1 = (Integer) c.getMethod("add", int.class, int.class).invoke(null, 2, 3);
    int s1 = (Integer) c.getMethod("sub", int.class, int.class).invoke(null, 7, 4);
    int a2 = (Integer) c.getMethod("add", int.class, int.class).invoke(null, -1, 5);
    int s2 = (Integer) c.getMethod("sub", int.class, int.class).invoke(null, 0, 0);

    assertEq("add(2,3)", a1, 5);
    assertEq("sub(7,4)", s1, 3);
    assertEq("add(-1,5)", a2, 4);
    assertEq("sub(0,0)", s2, 0);

    System.out.println("passed=" + passed + " total=" + total);
    System.out.print(log.toString());

    if (passed != total) {
      System.exit(1);
    }
  }
}


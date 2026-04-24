#include <stdio.h>
#include <stdlib.h>

// Expected from submission.c
int add(int a, int b);
int sub(int a, int b);

static int passed = 0;
static int total = 0;

static void assert_eq(const char* name, int actual, int expected) {
  total++;
  if (actual == expected) {
    passed++;
    printf("PASS %s\n", name);
  } else {
    printf("FAIL %s expected=%d actual=%d\n", name, expected, actual);
  }
}

int main(void) {
  assert_eq("add(2,3)", add(2, 3), 5);
  assert_eq("sub(7,4)", sub(7, 4), 3);
  assert_eq("add(-1,5)", add(-1, 5), 4);
  assert_eq("sub(0,0)", sub(0, 0), 0);

  printf("passed=%d total=%d\n", passed, total);
  if (passed != total) return 1;
  return 0;
}


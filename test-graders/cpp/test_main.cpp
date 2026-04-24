#include <iostream>

// Expected from submission.cpp
int add(int a, int b);
int sub(int a, int b);

static int passed = 0;
static int total = 0;

static void assert_eq(const char* name, int actual, int expected) {
  total++;
  if (actual == expected) {
    passed++;
    std::cout << "PASS " << name << "\n";
  } else {
    std::cout << "FAIL " << name << " expected=" << expected << " actual=" << actual << "\n";
  }
}

int main() {
  assert_eq("add(2,3)", add(2, 3), 5);
  assert_eq("sub(7,4)", sub(7, 4), 3);
  assert_eq("add(-1,5)", add(-1, 5), 4);
  assert_eq("sub(0,0)", sub(0, 0), 0);

  std::cout << "passed=" << passed << " total=" << total << "\n";
  return (passed == total) ? 0 : 1;
}


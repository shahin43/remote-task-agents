export function greeting(name) {
  return "Hello " + name + "!!";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(greeting("world"));
}

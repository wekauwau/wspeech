env "local" {
  src = "file://schema"
  dev = "docker://postgres/17?search_path=public"
  migration {
    dir = "file://migrations"
  }
  lint {
    destructive {
      error = true
    }
  }
}

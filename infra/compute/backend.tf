# State lives in the bootstrap bucket. Bucket name comes from backend.hcl (git-ignored):
#   terraform init -backend-config=backend.hcl
terraform {
  backend "s3" {
    key          = "compute/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

#!/bin/bash
PB_URL="https://inletcapital.pockethost.io"
ADMIN_EMAIL="aturaerick@gmail.com"
ADMIN_PASS='dGY@SrzA86PQc5n'

# Authenticate
AUTH_RES=$(curl -s -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")

TOKEN=$(echo $AUTH_RES | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Auth failed!"
  echo $AUTH_RES
  exit 1
fi
echo "Authenticated."

# Update users collection to add role
USERS_COLL=$(curl -s -X GET "$PB_URL/api/collections/users" -H "Authorization: $TOKEN")
if [[ "$USERS_COLL" != *"\"name\":\"role\""* ]]; then
  echo "Adding role field to users collection..."
  curl -s -X PATCH "$PB_URL/api/collections/users" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "fields": [
        {"name": "name", "type": "text"},
        {"name": "avatar", "type": "file"},
        {
          "name": "role",
          "type": "select",
          "required": true,
          "values": ["super_admin", "admin", "manager", "loan_officer", "cashier", "group_officer", "auditor"],
          "maxSelect": 1
        }
      ]
    }'
else
  echo "Users collection already has role field."
fi

echo "Updating users collection API rules..."
curl -s -X PATCH "$PB_URL/api/collections/users" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "listRule": "@request.auth.role = \"super_admin\" || @request.auth.role = \"admin\"",
    "viewRule": "@request.auth.role = \"super_admin\" || @request.auth.role = \"admin\"",
    "createRule": "@request.auth.role = \"super_admin\"",
    "updateRule": "@request.auth.role = \"super_admin\"",
    "deleteRule": "@request.auth.role = \"super_admin\""
  }'

# Get Users Collection ID
USERS_ID=$(curl -s -X GET "$PB_URL/api/collections/users" -H "Authorization: $TOKEN" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
echo "Users Collection ID: $USERS_ID"

# Create groups collection
echo "Creating groups collection..."
curl -s -X POST "$PB_URL/api/collections" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "groups",
    "type": "base",
    "fields": [
      { "name": "group_id", "type": "text", "required": true, "unique": true },
      { "name": "name", "type": "text", "required": true },
      { "name": "meeting_day", "type": "select", "maxSelect": 1, "values": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
      { "name": "meeting_time", "type": "text" },
      { "name": "location", "type": "text" },
      { "name": "chairperson", "type": "text" },
      { "name": "secretary", "type": "text" },
      { "name": "treasurer", "type": "text" },
      { "name": "registration_fee", "type": "number" },
      { "name": "registration_date", "type": "date", "required": true },
      { "name": "performance_rating", "type": "number" },
      { "name": "status", "type": "select", "required": true, "maxSelect": 1, "values": ["active", "dormant", "dissolved"] },
      { "name": "phone", "type": "text" },
      { "name": "member_count", "type": "number" },
      { "name": "total_savings", "type": "number" },
      { "name": "outstanding_loan", "type": "number" },
      { "name": "created_by", "type": "relation", "relationOptions": { "collectionId": "'$USERS_ID'", "cascadeDelete": false } }
    ],
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\"",
    "createRule": "@request.auth.role != \"auditor\"",
    "updateRule": "@request.auth.role != \"auditor\"",
    "deleteRule": "@request.auth.role = \"super_admin\" || @request.auth.role = \"admin\""
  }'

# Get Groups Collection ID
GROUPS_ID=$(curl -s -X GET "$PB_URL/api/collections/groups" -H "Authorization: $TOKEN" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
echo "Groups Collection ID: $GROUPS_ID"

# Create members collection
echo "Creating members collection..."
curl -s -X POST "$PB_URL/api/collections" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "members",
    "type": "base",
    "fields": [
      { "name": "reg_no", "type": "text", "required": true, "unique": true },
      { "name": "full_name", "type": "text", "required": true },
      { "name": "id_number", "type": "text", "required": true },
      { "name": "phone", "type": "text", "required": true },
      { "name": "address", "type": "text" },
      { "name": "nok_name", "type": "text" },
      { "name": "nok_phone", "type": "text" },
      { "name": "nok_relationship", "type": "text" },
      { "name": "registration_fee", "type": "number" },
      { "name": "registration_date", "type": "date", "required": true },
      { "name": "status", "type": "select", "required": true, "maxSelect": 1, "values": ["active", "dormant", "exited"] },
      { "name": "group", "type": "relation", "relationOptions": { "collectionId": "'$GROUPS_ID'", "cascadeDelete": false } },
      { "name": "registered_by", "type": "relation", "relationOptions": { "collectionId": "'$USERS_ID'", "cascadeDelete": false } }
    ],
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\"",
    "createRule": "@request.auth.role != \"auditor\"",
    "updateRule": "@request.auth.role != \"auditor\"",
    "deleteRule": "@request.auth.role = \"super_admin\" || @request.auth.role = \"admin\""
  }'

echo "Setup done."

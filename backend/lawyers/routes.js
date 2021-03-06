const express = require("express");
const Joi = require("joi");
const models = require("../models/modelsStore");
const bcrypt = require("bcrypt");
const { requireSignIn } = require("../configuration/passport");
const jwt = require("jsonwebtoken");
const config = require("../configuration/config");
const {
  checkIfEmailIsAlreadyUsedAsUser,
  capitalizeFirstLetter,
} = require("../helpers/utils");

// Initializing Router
const router = express.Router();

// User SignUp API
router.post("/signup", async (req, res) => {
  const schema = Joi.object({
    name: Joi.string()
      .required()
      .max(64)
      .regex(/^[a-zA-Z ]*$/)
      .messages({
        "any.required": "Enter a valid name.",
        "string.empty": "Enter a valid name.",
        "string.pattern.base": "Enter a valid name",
        "string.max": "Length of the name should not exceed 64 characters",
      }),
    email: Joi.string()
      .email({
        minDomainSegments: 2,
        tlds: { allow: ["com", "net"] },
      })
      .required()
      .messages({
        "string.email": "Enter a valid email.",
        "string.empty": "Enter a valid email.",
        "any.required": "Enter a valid email.",
      }),
    password: Joi.string().required().messages({
      "string.empty": "Password is required.",
      "any.required": "Password is required.",
    }),
  });

  // Validating schema for the input fields
  const result = await schema.validate(req.body);
  if (result.error) {
    res.status(400).send({ errorMessage: result.error.details[0].message });
    return;
  }

  // Check whether this email is used by lawyer or not
  const isEmailUsed = await checkIfEmailIsAlreadyUsedAsUser(req.body.email);

  if (isEmailUsed) {
    res.status(400).send({
      errorMessage: "Account belonging to this email already exists.",
    });
    return;
  } else {
    // Create lawyer
    const name = req.body.name;
    const email = req.body.email;
    const password = req.body.password;
    const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt());
    const userObject = {
      name: name,
      email: email,
      password: hashedPassword,
      type: config.LAWYER_TYPE,
    };
    const rawUser = new models.lawyers(userObject);
    try {
      const user = await rawUser.save();
      const payload = {
        _id: user._id,
        name: name,
        email: email,
        type: config.LAWYER_TYPE,
      };
      const jwtToken = jwt.sign(payload, config.jwtSecretKey, {
        expiresIn: config.jwtExpiryTime,
      });
      const response = {
        _id: user._id,
        name: capitalizeFirstLetter(user.name),
        email: user.email,
        type: config.LAWYER_TYPE,
        token: jwtToken,
        isApproved: false,
      };
      res.status(200).send(response);
      return;
    } catch (error) {
      if (error.code === config.databaseErrorCodes.uniqueKeyConstraintError) {
        res.status(400).send({
          errorMessage: "Account belonging to this email already exists.",
        });
      } else {
        res.status(400).send({
          errorMessage: error,
        });
      }
    }
  }
});

// Login route
router.post("/login", async (req, res) => {
  // Creating a schema for validating input fields
  const schema = Joi.object({
    email: Joi.string()
      .email({
        minDomainSegments: 2,
        tlds: { allow: ["com", "net"] },
      })
      .required()
      .messages({
        "string.email": "Must be a valid email.",
        "string.empty": "Email cannot be empty.",
        "any.required": "Email is required.",
      }),
    password: Joi.string().required().messages({
      "string.empty": "Password is required.",
      "any.required": "Password cannot be empty",
    }),
  });
  // Validate the input fields
  const result = await schema.validate(req.body);
  if (result.error) {
    res.status(400).send({ errorMessage: result.error.details[0].message });
    return;
  }

  // Login
  models.lawyers
    .findOne({
      email: req.body.email.toLowerCase(),
    })
    .then(async (user) => {
      console.log(user);
      if (
        user == null ||
        !(await bcrypt.compare(req.body.password, user.password))
      ) {
        res.status(400).send({ errorMessage: "Invalid email or password" });
      } else {
        let unsignedJwtUserObject = {
          _id: user._id,
          name: capitalizeFirstLetter(user.name),
          email: user.email,
          type: config.LAWYER_TYPE,
          isApproved: user.isApprovedByAdmin,
        };
        // Generate a JWT token
        const jwtToken = jwt.sign(unsignedJwtUserObject, config.jwtSecretKey, {
          expiresIn: config.jwtExpiryTime,
        });

        unsignedJwtUserObject = Object.assign(unsignedJwtUserObject, {
          language: user.language,
          number: user.number,
          timezone: user.timezone,
          image: user.image,
        });

        console.log(user);
        console.log(unsignedJwtUserObject);
        res.status(200).send({
          ...unsignedJwtUserObject,
          token: jwtToken,
          message: "Logged in successfully.",
        });
      }
    })
    .catch((err) => {
      res.status(400).send({
        errorMessage: err,
      });
    });
});

router.get("/dashboard", requireSignIn, async (req, res) => {
  // Users not allowed
  console.log(req.user.type);
  if (req.user.type == config.USER_TYPE) {
    res.status(405).send({ errorMessage: "Users not allowed." });
  } else {
    const ongoingRentalAgreementCases = [];
    const completedRentalAgreementCases = [];
    const rejectedRentalAgreementCases = [];
    const ongoingMutualDivorceCases = [];
    const completedMutualDivorceCases = [];
    const rejectedMutualDivorceCases = [];
    const user = await models.lawyers
      .findById(
        req.user._id,
        "name email activeCases completedCases rejectedCases rentalAgreementCases mutualDivorceCases isApprovedByAdmin"
      )
      .populate({
        path: "rentalAgreementCases",
        select: "status type lawyer",
        populate: {
          path: "user",
          select: "name email",
        },
      })
      .populate({
        path: "mutualDivorceCases",
        select: "status type lawyer",
        populate: {
          path: "user",
          select: "name email",
        },
      });
    // Filter out rental agreement cases
    await user.rentalAgreementCases.forEach((temp) => {
      if (temp.status === config.APPROVED_STATUS) {
        completedRentalAgreementCases.push({
          _id: temp._id,
          user: temp.user,
          type: config.CASE_TYPE_RENTAL_AGREEMENT,
          status: temp.status,
        });
      } else if (temp.status === config.REJECTED_STATUS) {
        rejectedRentalAgreementCases.push({
          _id: temp._id,
          user: temp.user,
          type: config.CASE_TYPE_RENTAL_AGREEMENT,
          status: temp.status,
        });
      } else {
        ongoingRentalAgreementCases.push({
          _id: temp._id,
          user: temp.user,
          type: config.CASE_TYPE_RENTAL_AGREEMENT,
          status: temp.status,
        });
      }
    });

    // Filter out the mutual divorce cases
    await user.mutualDivorceCases.forEach((temp) => {
      if (temp.status === config.APPROVED_STATUS) {
        completedMutualDivorceCases.push({
          _id: temp._id,
          user: temp.user,
          type: config.CASE_TYPE_MUTUAL_DIVORCE,
          status: temp.status,
        });
      } else if (temp.status === config.REJECTED_STATUS) {
        rejectedMutualDivorceCases.push({
          _id: temp._id,
          user: temp.user,
          type: config.CASE_TYPE_MUTUAL_DIVORCE,
          status: temp.status,
        });
      } else {
        ongoingMutualDivorceCases.push({
          _id: temp._id,
          user: temp.user,
          type: config.CASE_TYPE_MUTUAL_DIVORCE,
          status: temp.status,
        });
      }
    });

    res.status(200).send({
      _id: user._id,
      name: user.name,
      email: user.email,
      type: config.LAWYER_TYPE,
      ongoingRentalAgreementCases,
      completedRentalAgreementCases,
      rejectedRentalAgreementCases,
      ongoingMutualDivorceCases,
      completedMutualDivorceCases,
      rejectedMutualDivorceCases,
      activeCases: user.activeCases,
      completedCases: user.completedCases,
      rejectedCases: user.rejectedCases,
    });
  }
});

router.post("/updatelawyer", async (req, res) => {
  console.log("inside update lawyer");
  console.log("req.body", req.body);
  models.lawyers
    .findOne({
      _id: req.body.user_id,
    })
    .then(async (lawyer) => {
      if (lawyer === null) {
        res.status(201).send({
          errorMessage: "No lawyer Details",
        });
      } else {
        //update lawyer profile
        (lawyer.name = req.body.name || lawyer.name),
          (lawyer.email = req.body.email || lawyer.email),
          (lawyer.number = req.body.number || lawyer.number);
        (lawyer.address = req.body.address || lawyer.address),
          (lawyer.practicingCity =
            req.body.practicingCity || lawyer.practicingCity),
          (lawyer.zipCode = req.body.zipCode || lawyer.zipCode),
          (lawyer.specializations =
            req.body.specializations || lawyer.specializations),
          (lawyer.practicingCourt =
            req.body.practicingCourt || lawyer.practicingCourt),
          (lawyer.education = req.body.education || lawyer.education),
          (lawyer.experience = req.body.experience || lawyer.experience),
          (lawyer.barCouncilNumber =
            req.body.barCouncilNumber || lawyer.barCouncilNumber),
          (lawyer.gender = req.body.gender || lawyer.gender),
          console.log("saving Lawyer information: ");
        lawyer.save((err) => {
          if (err) {
            console.log("save error", err);
            res.status(400).send({
              errorMessage: err,
            });
          } else {
            console.log("lawyer updated successfully");
            res.status(200).send({
              message: "Lawyer updated successfully.",
            });
          }
        });
      }
    })
    .catch((err) => {
      res.status(400).send({
        errorMessage: err,
      });
    });
});

router.post("/getlawyer/:user_id", async (req, res) => {
  console.log("inside get lawyer profile");
  console.log("req.body", req.params.user_id);
  models.lawyers
    .findOne({
      _id: req.params.user_id,
    })
    .then(async (lawyer) => {
      if (lawyer === null) {
        res.status(201).send({
          errorMessage: "No user Details",
        });
      } else {
        let lawyerObject = {
          _id: lawyer._id,
          name: capitalizeFirstLetter(lawyer.name),
          email: lawyer.email,
          number: lawyer.number,
          address: lawyer.address,
          practicingCity: lawyer.practicingCity,
          zipCode: lawyer.zipCode,
          specializations: lawyer.specializations,
          practicingCourt: lawyer.practicingCourt,
          education: lawyer.education,
          experience: lawyer.experience,
          barCouncilNumber: lawyer.barCouncilNumber,
          gender: lawyer.gender,
          isApprovedByAdmin: lawyer.isApprovedByAdmin,
          type: config.LAWYER_TYPE,
        };
        console.log("lawyerObject", lawyerObject);

        res.status(200).send({
          ...lawyerObject,
          message: "Lawyer fetched  successfully.",
        });
      }
    })
    .catch((err) => {
      res.status(400).send({
        errorMessage: err,
      });
    });
});

module.exports = router;
